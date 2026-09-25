import type { JunoApi } from './types'

declare global {
  interface Window {
    juno: JunoApi
  }
}

export {}
