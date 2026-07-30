"use client";

import { Sidebar } from "@/components/ui/sidebar";

interface PlatformPageProps {
  children: React.ReactNode;
}

export default function PlatformPage({ children }: PlatformPageProps) {
  return <Sidebar>{children}</Sidebar>;
}
