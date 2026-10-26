/** Classify historical navigation locally. No URL values or account identifiers leave this function. */
export function terminalDocumentScope(value:string,targetProfile:string):'TARGET_PROVIDER_ACCOUNT'|'OTHER_PUBLIC_PROVIDER'|null{
 let url:URL,target:URL;
 try{url=new URL(value);target=new URL(targetProfile);}catch(error:unknown){if(error instanceof TypeError)return null;throw error;}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash)return null;
 if(url.href===target.href)return 'TARGET_PROVIDER_ACCOUNT';
 if(url.hostname==='www.linkedin.com'&&target.hostname==='www.linkedin.com'){
  const segments=target.pathname.split('/'),account=segments[1]==='company'?segments[2]:null;
  if(account&&[`/company/${account}/`,`/company/${account}/admin/`,`/company/${account}/admin/dashboard/`,`/company/${account}/admin/page-posts/published/`].includes(url.pathname))return 'TARGET_PROVIDER_ACCOUNT';
 }
 if(['x.com','www.x.com','twitter.com','www.twitter.com'].includes(url.hostname)
  &&/^\/[A-Za-z0-9_]{1,50}(?:\/(?:with_replies|media|status\/\d+))?\/?$/.test(url.pathname)
  &&!['intent','compose','logout','settings','i'].includes(url.pathname.split('/')[1]!))return 'OTHER_PUBLIC_PROVIDER';
 return null;
}
