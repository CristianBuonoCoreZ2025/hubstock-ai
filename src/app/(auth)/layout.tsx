export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-sm">
        {children}
      </div>
    </div>
  )
}
