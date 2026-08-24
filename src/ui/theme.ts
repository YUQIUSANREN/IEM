export type ThemeChoice = 'system' | 'paper' | 'ink' | 'sea' | 'clay' | 'night'

export interface ThemeOption {
  id: ThemeChoice
  label: string
  hint: string
  swatches: [string, string, string]
}

export const THEME_STORAGE_KEY = 'iem-theme'

export const THEME_OPTIONS: ThemeOption[] = [
  { id: 'system', label: '跟随系统', hint: '浅色 / 深色随手机', swatches: ['#e8f0f6', '#2a6f97', '#c45c26'] },
  { id: 'paper', label: '宣纸', hint: '浅色 · 松绿', swatches: ['#f3efe4', '#2c6e5d', '#c23b2e'] },
  { id: 'ink', label: '墨夜', hint: '深色 · 松绿', swatches: ['#121714', '#6fbfa8', '#e07068'] },
  { id: 'night', label: '寒夜', hint: '深色 · 深蓝', swatches: ['#030205', '#131426', '#6772D5'] },
  { id: 'sea', label: '潮蓝', hint: '浅色 · 青蓝', swatches: ['#e8f0f6', '#2a6f97', '#c45c26'] },
  { id: 'clay', label: '朱泥', hint: '浅色 · 赭石', swatches: ['#f6eee6', '#9a4e32', '#2c6e5d'] },
]

let systemWatch: MediaQueryList | null = null

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function readThemeChoice(): ThemeChoice {
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (THEME_OPTIONS.some((item) => item.id === raw)) return raw as ThemeChoice
  return 'paper'
}

export function resolveTheme(choice: ThemeChoice): Exclude<ThemeChoice, 'system'> {
  if (choice === 'system') return prefersDark() ? 'ink' : 'sea'
  return choice
}

/** 深色主题要让系统控件（滚动条、输入框）也走 dark，不能只改预览色。 */
const DARK_THEMES = new Set<Exclude<ThemeChoice, 'system'>>(['ink', 'night'])

function paintMeta(resolved: Exclude<ThemeChoice, 'system'>): void {
  const moss = getComputedStyle(document.documentElement).getPropertyValue('--moss').trim()
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta && moss) meta.setAttribute('content', moss)
  document.documentElement.style.colorScheme = DARK_THEMES.has(resolved) ? 'dark' : 'light'
}

/**
 * 立刻换肤。choice 写入 localStorage；真正上色靠 html[data-theme] 对应的 CSS 变量，
 * 不是 ThemePicker 里那三个 swatches。
 */
export function applyTheme(choice: ThemeChoice): void {
  window.localStorage.setItem(THEME_STORAGE_KEY, choice)
  const resolved = resolveTheme(choice)
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.themeChoice = choice
  paintMeta(resolved)
  window.dispatchEvent(new Event('iem-theme'))
  if (choice === 'system') watchSystem()
  else stopSystemWatch()
}

function watchSystem(): void {
  if (systemWatch) return
  systemWatch = window.matchMedia('(prefers-color-scheme: dark)')
  systemWatch.addEventListener('change', onSystemChange)
}

function stopSystemWatch(): void {
  systemWatch?.removeEventListener('change', onSystemChange)
  systemWatch = null
}

function onSystemChange(): void {
  if (readThemeChoice() !== 'system') return
  applyTheme('system')
}

export function bootTheme(): void {
  applyTheme(readThemeChoice())
}
