"use client";

import { CtaCard } from "@/components/ui/cta-card";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AccessCodePage() {
  const router = useRouter();
  const [error, setError] = useState("");

  const handleAccessCode = async (code: string) => {
    setError("");
    
    if (!code.trim()) {
      setError("请输入访问码");
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
        // 保存访问码到 localStorage
        localStorage.setItem("access_code", code.trim());
        localStorage.setItem("access_code_id", data.access_code_id);
        // 跳转到首页
        router.push("/");
      } else {
        setError(data.error || "访问码无效或已过期");
      }
    } catch (err) {
      setError("验证失败，请稍后重试");
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-5xl">
        <CtaCard
          title="欢迎使用 Rising Path"
          description="输入您的专属访问码，开启智能求职之旅。AI 智能选岗、简历优化、自动网申，助力海外留学生拿到理想 Offer。"
          buttonText="进入平台"
          inputPlaceholder="请输入访问码"
          imageSrc="https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8M3x8YmFja2dyb3VuZHxlbnwwfHwwfHx8MA%3D%3D&auto=format&fit=crop&q=60&w=900&q=80&w=2574&auto=format&fit=crop"
          onButtonClick={handleAccessCode}
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
