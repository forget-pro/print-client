import { ipcRenderer, contextBridge } from 'electron'

const wrappedListeners = new WeakMap<Function, (...args: any[]) => void>()

function tracked(listener: (...args: any[]) => void) {
  const existing = wrappedListeners.get(listener)
  if (existing) return existing
  const wrapped = (event: unknown, ...args: unknown[]) => listener(event, ...args)
  wrappedListeners.set(listener, wrapped)
  return wrapped
}

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, tracked(listener))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, listener] = args
    if (typeof listener !== 'function') return ipcRenderer.off(channel)
    return ipcRenderer.off(channel, wrappedListeners.get(listener) || listener)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

// --------- Preload scripts loading ---------
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise((resolve) => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child)
    }
  },
}

function useLoading() {
  const styleContent = `
@keyframes app-loading-rise {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes app-loading-slide {
  0% { transform: translateX(-130%); }
  100% { transform: translateX(280%); }
}
.app-loading-wrap {
  position: fixed;
  inset: 0;
  z-index: 9;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(ellipse 70% 46% at 50% 42%, #ffffff 0%, rgba(255, 255, 255, 0) 68%),
    #eef1f6;
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
  color: #172033;
  opacity: 1;
  transition: opacity 0.28s ease;
}
.app-loading-wrap.is-leaving {
  opacity: 0;
}
.app-loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: app-loading-rise 0.45s ease both;
}
.app-loading-logo {
  width: 84px;
  height: 84px;
  filter: drop-shadow(0 16px 28px rgba(37, 99, 235, 0.28));
}
.app-loading-title {
  margin: 18px 0 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.12em;
}
.app-loading-sub {
  margin: 8px 0 0;
  font-size: 12px;
  letter-spacing: 0.08em;
  color: #7b8798;
}
.app-loading-track {
  width: 132px;
  height: 3px;
  margin-top: 22px;
  overflow: hidden;
  border-radius: 99px;
  background: #d5dce6;
}
.app-loading-bar {
  width: 42%;
  height: 100%;
  border-radius: inherit;
  background: #1d4ed8;
  animation: app-loading-slide 1.05s ease-in-out infinite;
}
    `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')
  let leaving = false

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `
    <div class="app-loading-card">
      <img class="app-loading-logo" src="./logo.png" alt="" />
      <p class="app-loading-title">图片打印</p>
      <p class="app-loading-sub">正在打开</p>
      <div class="app-loading-track"><div class="app-loading-bar"></div></div>
    </div>
  `

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      if (leaving) return
      leaving = true
      oDiv.classList.add('is-leaving')
      window.setTimeout(() => {
        safeDOM.remove(document.head, oStyle)
        safeDOM.remove(document.body, oDiv)
      }, 280)
    },
  }
}

// ----------------------------------------------------------------------

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading()
}

setTimeout(removeLoading, 4999)
