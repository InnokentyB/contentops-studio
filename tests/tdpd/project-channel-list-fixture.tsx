import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {AuthContext, type AuthContextType} from '../../frontend/src/context/auth';
import {LocaleContext} from '../../frontend/src/i18n/locale';
import {ToastContext} from '../../frontend/src/components/toast';
import Settings from '../../frontend/src/pages/Settings';
import '../../frontend/src/index.css';

const params=new URLSearchParams(window.location.search);
const locale=params.get('lang')==='en'?'en':'ru';
const project={id:101,name:'Синтетический проект',role:'owner' as const};
const auth:AuthContextType={user:{id:202,email:'fixture@example.invalid'},currentProject:project,projects:[project],
 token:'synthetic-only',isAuthenticated:true,isLoading:false,login:()=>undefined,logout:()=>undefined,
 setCurrentProject:()=>undefined,createProject:()=>undefined};
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}>
 <AuthContext.Provider value={auth}><LocaleContext.Provider value={{locale,setLocale:()=>undefined,t:key=>key}}>
 <ToastContext.Provider value={{showToast:()=>undefined,hideToast:()=>undefined}}><Settings/></ToastContext.Provider>
 </LocaleContext.Provider></AuthContext.Provider>
</QueryClientProvider>);
