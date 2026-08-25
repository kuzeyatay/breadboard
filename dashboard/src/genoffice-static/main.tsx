import { createRoot } from 'react-dom/client'
import { htmlLang } from '@genoffice/i18n'
import { installScreenTips } from '@genoffice/ui'
import { App } from '@/vendor/genoffice/docs/src/renderer/App'
import { LocaleProvider, setModuleLang } from '@/vendor/genoffice/docs/src/renderer/i18n/locale'
import { installGenOfficeBridge } from '@/app/genoffice-docs/[artifactId]/genoffice-bridge'
import '@/vendor/genoffice/ui/src/tokens.css'
import '@/vendor/genoffice/ui/src/screentip.css'
import '@/vendor/genoffice/ui/src/color-picker.css'
import '@/vendor/genoffice/ui/src/dropdown.css'
import '@/vendor/genoffice/docs/src/renderer/styles.css'
import '@/vendor/genoffice/docs/src/renderer/fonts/fonts.css'
import '@/app/genoffice-docs/genoffice-host.css'

const params = new URLSearchParams(window.location.search)
const artifactId = params.get('artifactId')?.trim() ?? ''
const conversationId = params.get('conversationId')?.trim() ?? ''
const version = Number(params.get('version') ?? '0')
const root = document.getElementById('root')
const autoSaveDefaultVersionKey = 'breadboard.genoffice.autoSaveDefaultVersion'
const autoSaveDefaultVersion = '1'

if (!root || !artifactId || !conversationId) {
  document.body.textContent = 'This editor link is missing its artifact conversation.'
} else {
  installGenOfficeBridge({
    artifactId,
    conversationId,
    initialVersion: Number.isInteger(version) ? version : 0,
  })
  localStorage.setItem('aidocs.showAi', '1')
  if (localStorage.getItem(autoSaveDefaultVersionKey) !== autoSaveDefaultVersion) {
    localStorage.setItem('aidocs.autoSave', '1')
    localStorage.setItem(autoSaveDefaultVersionKey, autoSaveDefaultVersion)
  }
  setModuleLang('en')
  document.documentElement.lang = htmlLang('en')
  document.documentElement.setAttribute('data-theme', 'light')
  installScreenTips()
  createRoot(root).render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  )
}
