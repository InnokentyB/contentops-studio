import { createContext, useContext } from 'react'

export interface User {
    id: number
    email: string
    name?: string
}

export interface Project {
    id: number
    name: string
}

export interface AuthContextType {
    user: User | null
    currentProject: Project | null
    projects: Project[]
    token: string | null
    login: (token: string, user: User, projects: Project[]) => void
    logout: () => void
    setCurrentProject: (project: Project) => void
    isAuthenticated: boolean
    isLoading: boolean
    createProject: (project: Project) => void
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function useAuth() {
    const context = useContext(AuthContext)
    if (context === undefined) throw new Error('useAuth must be used within an AuthProvider')
    return context
}
