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
    <header className="glass-panel mb-6 flex flex-col gap-4 rounded-2xl p-5 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="app-page-title">{title}</h1>
        <p className="app-page-lead mt-1">{description}</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative w-full md:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Buscar producto..."
            className="app-input h-10 pl-10"
          />
        </div>

        <button
          type="button"
          className="glass-panel-subtle flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-foreground transition hover:opacity-90"
          aria-label="Notificaciones"
        >
          <Bell className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}