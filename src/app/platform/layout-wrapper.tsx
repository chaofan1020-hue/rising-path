"use client";

import PlatformLayout from "@/components/platform-layout";

interface PlatformPageProps {
  children: React.ReactNode;
}

export default function PlatformPage({ children }: PlatformPageProps) {
  return <PlatformLayout>{children}</PlatformLayout>;
}
