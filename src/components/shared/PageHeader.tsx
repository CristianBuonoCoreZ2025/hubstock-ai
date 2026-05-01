"use client";

import { Bell, Search } from "lucide-react";

type PageHeaderProps = {
  title?: string;
  description?: string;
};

export default function PageHeader({
  title = "HubStock AI",
  description = "Inventario inteligente para el hogar",
}: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">
          {title}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative w-full md:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Buscar producto..."
            className="h-10 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm outline-none transition focus:border-emerald-500 focus:bg-white"
          />
        </div>

        <button
          type="button"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
          aria-label="Notificaciones"
        >
          <Bell className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}