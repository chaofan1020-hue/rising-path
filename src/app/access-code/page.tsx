"use client";

import { CtaCard } from "@/components/ui/cta-card";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLanguage } from "@/lib/language-context";

export default function AccessCodePage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const { t } = useLanguage();

  const handleAccessCode = async (code: string) => {
    setError("");
    
    if (!code.trim()) {
      setError(t("accessCode.error.empty"));
      return;
    }

    try {
      const response = await fetch("/api/access-codes/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await response.json();

      if (response.ok && data.valid) {
        // 保存访问码到 localStorage（JSON 格式）
        localStorage.setItem("access_code", JSON.stringify(data.code));
        localStorage.setItem("access_code_id", String(data.code.id));
        // 跳转到首页或目标页面
        const targetPath = localStorage.getItem("target_path") || "/";
        localStorage.removeItem("target_path");
        router.push(targetPath);
      } else {
        setError(data.error || t("accessCode.error.invalid"));
      }
    } catch (err) {
      setError(t("accessCode.error.failed"));
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-6xl">
        <CtaCard
          title={t("accessCode.title")}
          description={t("accessCode.subtitle")}
          buttonText={t("accessCode.button")}
          inputPlaceholder={t("accessCode.placeholder")}
          imageSrc="https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8M3x8YmFja2dyb3VuZHxlbnwwfHwwfHx8MA%3D%3D&auto=format&fit=crop&q=60&w=900&q=80&w=2574&auto=format&fit=crop"
          onButtonClick={handleAccessCode}
          className="min-h-[200px] md:min-h-[250px]"
        />
        {error && (
          <div className="mt-4 text-center text-red-500 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
