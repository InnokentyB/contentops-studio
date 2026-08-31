import { createContext, useContext } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastMessage {
    id: string
    message: string
    type: ToastType
    details?: string
}

export interface ToastContextType {
    showToast: (message: string, type?: ToastType, details?: string) => void
    hideToast: (id: string) => void
}

export const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function useToast() {
    const context = useContext(ToastContext)
    if (!context) throw new Error('useToast must be used within a ToastProvider')
    return context
}
