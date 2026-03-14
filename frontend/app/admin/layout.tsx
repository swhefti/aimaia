export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#272a31]">
      {children}
    </div>
  );
}
