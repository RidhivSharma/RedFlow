import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  ADMIN_TARGET_MESSAGE,
  executeInsertion,
  UNKNOWN_TARGET_MESSAGE,
  type InsertionPorts,
  type TargetIntegrity
} from '../src/main/insertionFlow'
import { InsertionError } from '../src/main/insertionError'
import { parseProbeStatus } from '../src/main/targetIntegrity'

interface FakePortsOptions {
  readonly initialClipboard?: string
  /** 1-based write number that should fail; -1 means every write succeeds. */
  readonly failWriteOn?: number
}

interface FakePorts {
  readonly ports: InsertionPorts
  readonly calls: string[]
  readonly clipboard: () => string
}

function createFakePorts(options: FakePortsOptions = {}): FakePorts {
  const calls: string[] = []
  let clipboard = options.initialClipboard ?? 'previous clipboard'
  let writeCount = 0
  const failWriteOn = options.failWriteOn ?? -1

  return {
    calls,
    clipboard: () => clipboard,
    ports: {
      readClipboard: async () => {
        calls.push('read')
        return clipboard
      },
      writeClipboard: async (text) => {
        writeCount += 1
        calls.push(`write:${text}`)
        if (writeCount === failWriteOn) {
          throw new Error('clipboard write failed')
        }
        clipboard = text
      },
      tapPaste: () => {
        calls.push('tap')
      },
      delay: async (ms) => {
        calls.push(`delay:${ms}`)
      }
    }
  }
}

async function insert(
  target: TargetIntegrity,
  fake: FakePorts,
  payload = 'hello '
): Promise<Awaited<ReturnType<typeof executeInsertion>>> {
  return executeInsertion(target, payload, 350, fake.ports)
}

/** Mirrors the probe's collapse of elevated/higher-integrity into one unsafe result. */
function targetFromElevated(elevated: boolean | null): TargetIntegrity {
  if (elevated === null) {
    return 'unknown'
  }
  return elevated ? 'higher' : 'same-or-lower'
}

describe('executeInsertion', () => {
  test('elevated = true copies the transcript only and does not restore the old clipboard', async () => {
    const fake = createFakePorts()
    const outcome = await insert(targetFromElevated(true), fake)

    assert.deepEqual(outcome, {
      kind: 'clipboard-only',
      message: ADMIN_TARGET_MESSAGE
    })
    assert.deepEqual(fake.calls, ['write:hello '])
    assert.equal(fake.clipboard(), 'hello ')
  })

  test('elevated = unknown copies the transcript only, treating it as possibly elevated', async () => {
    const fake = createFakePorts()
    const outcome = await insert(targetFromElevated(null), fake)

    assert.deepEqual(outcome, {
      kind: 'clipboard-only',
      message: UNKNOWN_TARGET_MESSAGE
    })
    assert.deepEqual(fake.calls, ['write:hello '])
    assert.equal(fake.clipboard(), 'hello ')
  })

  test('elevated = false pastes, waits, then restores the previous clipboard', async () => {
    const fake = createFakePorts()
    const outcome = await insert(targetFromElevated(false), fake)

    assert.deepEqual(outcome, { kind: 'pasted' })
    assert.deepEqual(fake.calls, [
      'read',
      'write:hello ',
      'tap',
      'delay:350',
      'write:previous clipboard'
    ])
    assert.equal(fake.clipboard(), 'previous clipboard')
  })

  test('a clipboard failure in the elevated path reports clipboard-failed and never taps', async () => {
    const fake = createFakePorts({ failWriteOn: 1 })

    await assert.rejects(
      () => insert('higher', fake),
      (error: unknown) => {
        assert.ok(error instanceof InsertionError)
        assert.equal(error.code, 'clipboard-failed')
        return true
      }
    )
    assert.deepEqual(fake.calls, ['write:hello '])
  })

  test('a restore failure reports restore-failed after the paste', async () => {
    const fake = createFakePorts({ failWriteOn: 2 })

    await assert.rejects(
      () => insert('same-or-lower', fake),
      (error: unknown) => {
        assert.ok(error instanceof InsertionError)
        assert.equal(error.code, 'restore-failed')
        return true
      }
    )
    assert.deepEqual(fake.calls, [
      'read',
      'write:hello ',
      'tap',
      'delay:350',
      'write:previous clipboard'
    ])
  })
})

describe('parseProbeStatus', () => {
  test('accepts the three known probe results', () => {
    assert.equal(parseProbeStatus('{"status":"same-or-lower"}'), 'same-or-lower')
    assert.equal(parseProbeStatus('{"status":"higher"}'), 'higher')
    assert.equal(parseProbeStatus('{"status":"unknown"}'), 'unknown')
  })

  test('treats malformed or unexpected output as unknown', () => {
    assert.equal(parseProbeStatus('not json'), 'unknown')
    assert.equal(parseProbeStatus('{"status":"medium"}'), 'unknown')
    assert.equal(parseProbeStatus('{"noStatus":true}'), 'unknown')
  })
})
