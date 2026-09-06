import type { ReactNode } from "react";

export type IconName = "grid"|"file"|"template"|"dictionary"|"settings"|"panel"|"plus"|"check"|"alert"|"close"|"arrow"|"search"|"refresh"|"clock"|"circle"|"eye"|"edit"|"lock"|"more"|"info"|"copy"|"external"|"chevron"|"filter"|"check-circle"|"x-circle"|"upload"|"drag"|"star"|"layers"|"zap"|"stop"|"spin"|"bookmark"|"hash"|"shield";

const paths: Record<IconName, ReactNode> = {
  grid:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  file:<><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></>,
  template:<><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/></>,
  dictionary:<><path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17.5H7.5A2.5 2.5 0 0 0 5 22z"/><path d="M5 4.5v15M9 7h6M9 11h6"/></>,
  settings:<><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.3 3h-4l-.3 2.6a7 7 0 0 0-2 1.2L5.7 5.9l-2 3.4 2 1.5A7 7 0 0 0 5.7 13l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.3 2.6h4l.3-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z"/></>,
  panel:<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>,
  plus:<path d="M12 5v14M5 12h14"/>,
  check:<path d="m5 12 4.2 4.2L19 6.5"/>,
  alert:<><path d="M10.3 4.1 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
  close:<path d="m6 6 12 12M18 6 6 18"/>,
  arrow:<><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
  search:<><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>,
  refresh:<><path d="M20 11a8 8 0 0 0-14.9-4L3 9"/><path d="M3 4v5h5M4 13a8 8 0 0 0 14.9 4L21 15"/><path d="M21 20v-5h-5"/></>,
  clock:<><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></>,
  circle:<circle cx="12" cy="12" r="7.5"/>,
  eye:<><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
  edit:<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></>,
  lock:<><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
  more:<><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></>,
  info:<><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></>,
  copy:<><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  external:<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="m10 14 11-11"/></>,
  chevron:<path d="m6 9 6 6 6-6"/>,
  filter:<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>,
  "check-circle":<><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-5"/></>,
  "x-circle":<><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></>,
  upload:<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,
  drag:<><path d="M9 3h1M9 7h1M9 11h1M14 3h1M14 7h1M14 11h1"/></>,
  star:<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>,
  layers:<><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></>,
  zap:<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>,
  stop:<rect x="4" y="4" width="16" height="16" rx="2"/>,
  spin:<><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v9h-9"/></>,
  bookmark:<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>,
  hash:<><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></>,
  shield:<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>,
};

export function Icon({name,size=18}:{name:IconName;size?:number}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function Button({children,onClick,variant="primary",className="",disabled=false}:{children:ReactNode;onClick?:()=>void;variant?:"primary"|"secondary"|"ghost";className?:string;disabled?:boolean}) {
  const x={primary:"border-[#2E5495] bg-[#2E5495] text-white hover:bg-[#24457C] disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed",secondary:"border-slate-300 bg-white text-slate-700 hover:border-[#2E5495] hover:text-[#24457C] disabled:opacity-50 disabled:cursor-not-allowed",ghost:"border-transparent text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"};
  return <button onClick={onClick} disabled={disabled} className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors ${x[variant]} ${className}`}>{children}</button>;
}

export function Badge({children,tone="neutral"}:{children:ReactNode;tone?:"neutral"|"info"|"warning"|"success"|"danger"}) {
  const x={neutral:"bg-slate-100 text-slate-600",info:"bg-[#F2F6FC] text-[#24457C]",warning:"bg-[#FFF7E6] text-[#8B520B]",success:"bg-[#ECF8F2] text-[#116B46]",danger:"bg-[#FEF1F2] text-[#A8323C]"};
  return <span className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium ${x[tone]}`}><span className="size-1 rounded-full bg-current"/>{children}</span>;
}

export function Search({placeholder}:{placeholder:string}) {
  return <label className="relative block"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" size={17}/></span><input className="h-10 w-[260px] max-w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-[#2E5495] focus:ring-2 focus:ring-[#DCE7F7]" placeholder={placeholder}/></label>;
}

export function Dialog({title,description,onClose,children,wide=false}:{title:string;description:string;onClose:()=>void;children:ReactNode;wide?:boolean}) {
  return <div className="fixed inset-0 z-30 grid place-items-center bg-slate-950/25 p-6" onClick={(e)=>{if(e.target===e.currentTarget)onClose()}}><div className={`w-full ${wide?"max-w-[960px]":"max-w-[640px]"} rounded-xl border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,.18)]`}><div className="flex items-start justify-between border-b border-slate-200 px-6 py-5"><div><h2 className="text-xl font-semibold text-slate-800">{title}</h2><p className="mt-1 text-[13px] text-slate-500">{description}</p></div><button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Icon name="close"/></button></div><div className="p-6">{children}</div></div></div>;
}

export function Drawer({title,onClose,children,width="w-[420px]"}:{title:string;onClose:()=>void;children:ReactNode;width?:string}) {
  return <div className="fixed inset-0 z-20"><button aria-label="关闭抽屉" onClick={onClose} className="absolute inset-0 bg-slate-950/10"/><aside className={`absolute right-0 top-0 h-full ${width} max-w-[calc(100vw-48px)] border-l border-slate-200 bg-white shadow-[-12px_0_30px_rgba(15,23,42,.08)]`}><div className="flex h-16 items-center justify-between border-b border-slate-200 px-6"><h2 className="font-semibold text-slate-800">{title}</h2><button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Icon name="close"/></button></div><div className="h-[calc(100%-64px)] overflow-auto p-6">{children}</div></aside></div>;
}

export function PageHeader({title,sub,action}:{title:string;sub:string;action?:ReactNode}) {
  return <div className="flex items-end justify-between gap-5"><div><h1 className="text-[28px] font-semibold tracking-[-.02em] text-slate-900">{title}</h1><p className="mt-2 text-sm text-slate-500">{sub}</p></div>{action}</div>;
}
