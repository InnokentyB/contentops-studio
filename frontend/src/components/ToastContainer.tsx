import React, { createContext, useContext, useState, useCallback } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
    id: string;
    message: string;
    type: ToastType;
    details?: string;
}

interface ToastContextType {
    showToast: (message: string, type?: ToastType, details?: string) => void;
    hideToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    const hideToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const showToast = useCallback((message: string, type: ToastType = 'info', details?: string) => {
        const id = Math.random().toString(36).substring(2, 9);
        const newToast: ToastMessage = { id, message, type, details };
        setToasts((prev) => [...prev, newToast]);

        // Auto dismiss after 4 seconds
        setTimeout(() => {
            hideToast(id);
        }, 4500);
    }, [hideToast]);

    return (
        <ToastContext.Provider value={{ showToast, hideToast }}>
            {children}
            <ToastContainer toasts={toasts} onDismiss={hideToast} />
        </ToastContext.Provider>
    );
};

const ToastContainer: React.FC<{
    toasts: ToastMessage[];
    onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => {
    return (
        <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-3 max-w-md w-full pointer-events-none">
            {toasts.map((toast) => (
                <ToastCard key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
            ))}
        </div>
    );
};

const ToastCard: React.FC<{
    toast: ToastMessage;
    onDismiss: () => void;
}> = ({ toast, onDismiss }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        if (toast.details) {
            navigator.clipboard.writeText(toast.details);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    // Color definitions matching the premium aesthetics
    let typeStyles = '';
    let icon = '';
    switch (toast.type) {
        case 'success':
            typeStyles = 'bg-emerald-950/80 border-emerald-500/30 text-emerald-100 shadow-emerald-950/20';
            icon = 'check_circle';
            break;
        case 'error':
            typeStyles = 'bg-rose-950/80 border-rose-500/30 text-rose-100 shadow-rose-950/20';
            icon = 'error';
            break;
        case 'warning':
            typeStyles = 'bg-amber-950/80 border-amber-500/30 text-amber-100 shadow-amber-950/20';
            icon = 'warning';
            break;
        case 'info':
        default:
            typeStyles = 'bg-slate-900/80 border-slate-700/30 text-slate-100 shadow-slate-950/20';
            icon = 'info';
            break;
    }

    return (
        <div
            className={`toast-card pointer-events-auto flex flex-col p-4 rounded-xl border backdrop-blur-md shadow-lg transition-all duration-300 transform translate-x-0 animate-slide-in-right ${typeStyles}`}
            style={{
                animation: 'slideInRight 0.3s ease-out forwards',
            }}
        >
            <div className="flex items-start justify-between gap-3">
                <span className="material-symbols-outlined shrink-0 text-xl mt-0.5">
                    {icon}
                </span>
                <div className="flex-1 text-sm font-medium pr-2 break-words">
                    {toast.message}
                </div>
                <button
                    onClick={onDismiss}
                    className="shrink-0 text-slate-400 hover:text-white transition-colors duration-150"
                >
                    <span className="material-symbols-outlined text-lg">close</span>
                </button>
            </div>

            {toast.details && (
                <div className="mt-3 pt-3 border-t border-white/10 flex flex-col gap-2">
                    <pre className="text-xs bg-black/30 p-2 rounded overflow-x-auto max-h-24 max-w-full whitespace-pre-wrap break-all">
                        {toast.details}
                    </pre>
                    <button
                        onClick={handleCopy}
                        className="self-end text-xs font-semibold px-2 py-1 bg-white/10 hover:bg-white/20 rounded transition-all duration-150 flex items-center gap-1"
                    >
                        <span className="material-symbols-outlined text-[14px]">
                            {copied ? 'check' : 'content_copy'}
                        </span>
                        {copied ? 'Copied' : 'Copy details'}
                    </button>
                </div>
            )}
        </div>
    );
};

// Injection of animation styles
if (typeof document !== 'undefined') {
    const styleId = 'toast-animation-styles';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = `
            @keyframes slideInRight {
                from {
                    opacity: 0;
                    transform: translateX(100%);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }
        `;
        document.head.appendChild(style);
    }
}
