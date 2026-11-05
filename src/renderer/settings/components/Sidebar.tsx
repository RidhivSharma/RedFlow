import { useRef, type KeyboardEvent } from 'react'
import type { AppInfo } from '@shared/ipc'
import logoUrl from '../assets/redflow-logo.png'
import { panelId, tabId, type SectionId } from '../sections'
import { ChipIcon, KeyboardIcon, MicrophoneIcon, PowerIcon, SparkleIcon } from './icons'

interface NavItem {
  readonly id: SectionId
  readonly label: string
  readonly Icon: (props: { readonly size?: number }) => React.JSX.Element
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: 'dictation', label: 'Dictation', Icon: KeyboardIcon },
  { id: 'cleanup', label: 'Text cleanup', Icon: SparkleIcon },
  { id: 'microphone', label: 'Microphone', Icon: MicrophoneIcon },
  { id: 'model', label: 'Model & language', Icon: ChipIcon },
  { id: 'system', label: 'System', Icon: PowerIcon }
]

interface SidebarProps {
  readonly activeSection: SectionId
  readonly onSelect: (section: SectionId) => void
  readonly appInfo: AppInfo | null
}

/**
 * Brand block, the vertical section tablist, and the version footer. Below
 * 820 px the labels fold away and only the icon rail remains.
 */
function Sidebar({ activeSection, onSelect, appInfo }: SidebarProps): React.JSX.Element {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number | null = null

    if (event.key === 'ArrowDown') {
      nextIndex = (index + 1) % NAV_ITEMS.length
    } else if (event.key === 'ArrowUp') {
      nextIndex = (index - 1 + NAV_ITEMS.length) % NAV_ITEMS.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = NAV_ITEMS.length - 1
    }

    if (nextIndex === null) {
      return
    }

    const next = NAV_ITEMS[nextIndex]
    if (next === undefined) {
      return
    }

    event.preventDefault()
    onSelect(next.id)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img className="brand-mark" src={logoUrl} alt="" />
        <div className="brand-copy">
          <span className="brand-name">Redflow</span>
          <span className="brand-eyebrow">Settings</span>
        </div>
      </div>

      <div
        className="sidebar-nav"
        role="tablist"
        aria-orientation="vertical"
        aria-label="Settings sections"
      >
        {NAV_ITEMS.map((item, index) => {
          const Icon = item.Icon
          const selected = item.id === activeSection

          return (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[index] = node
              }}
              id={tabId(item.id)}
              type="button"
              role="tab"
              className="sidebar-tab"
              aria-selected={selected}
              aria-controls={panelId(item.id)}
              aria-label={item.label}
              title={item.label}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span className="sidebar-tab-icon">
                <Icon size={18} />
              </span>
              <span className="sidebar-tab-label">{item.label}</span>
            </button>
          )
        })}
      </div>

      {appInfo !== null ? (
        <div className="sidebar-footer">
          <p>Redflow {appInfo.version}</p>
          <p>Electron {appInfo.electronVersion}</p>
          <p className="sidebar-footer-hint">Changes apply instantly</p>
        </div>
      ) : null}
    </aside>
  )
}

export default Sidebar
