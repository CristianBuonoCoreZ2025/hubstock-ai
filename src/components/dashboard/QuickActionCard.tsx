import Link from "next/link";
import type { LucideIcon } from "lucide-react";

type QuickActionCardProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  href?: string;
  actionLabel?: string;
  actionText?: string;
  onClick?: () => void;
};

export default function QuickActionCard({
  title,
  description,
  href,
  icon: Icon,
  actionLabel,
  actionText,
  onClick,
}: QuickActionCardProps) {
  const label = actionText ?? actionLabel ?? "Abrir";

  const content = (
    <div className="flex items-start gap-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition group-hover:bg-emerald-50 group-hover:text-emerald-700">
        <Icon className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-950">{title}</p>
        <p className="mt-1 text-sm leading-5 text-slate-500">
          {description}
        </p>
        <p className="mt-3 text-sm font-medium text-emerald-700">
          {label}
        </p>
      </div>
    </div>
  );

  const className =
    "group block w-full rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md";

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}