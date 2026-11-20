"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { ImagePlus, Loader2 } from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LogoUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  initialCompanyName?: string;
  currentLogoUrl?: string | null;
  fallbackLogoUrl?: string | null;
}

const fullImageCrop: PercentCrop = { unit: "%", x: 0, y: 0, width: 100, height: 100 };
const supportedFileTypes = "image/jpeg,image/png,image/gif,image/webp,image/svg+xml";

export function LogoUploadDialog({ open, onOpenChange, onSuccess, initialCompanyName = "", currentLogoUrl, fallbackLogoUrl }: LogoUploadDialogProps) {
  const [newCompanyName, setNewCompanyName] = useState("");
  const [selection, setSelection] = useState<{ url: string; name: string } | null>(null);
  const [crop, setCrop] = useState<PercentCrop>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const imgRef = useRef<HTMLImageElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const companyName = initialCompanyName || newCompanyName.trim();

  useEffect(() => {
    if (!selection) return;
    return () => URL.revokeObjectURL(selection.url);
  }, [selection]);

  // 监听 dialog 关闭，重置状态
  const handleOpenChange = (isOpen: boolean) => {
    if (uploading) return;
    if (!isOpen) {
      setSelection(null);
      setNewCompanyName("");
      setCrop(undefined);
      setError("");
    }
    onOpenChange(isOpen);
  };

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setError("");
    setCrop(undefined);
    setSelection({ url: URL.createObjectURL(file), name: file.name });
  };

  const onImageLoad = useCallback(() => {
    setCrop(fullImageCrop);
  }, []);

  const getCroppedImage = async (): Promise<Blob | null> => {
    if (!imgRef.current || !crop?.width || !crop.height || !imgRef.current.src) return null;

    const image = imgRef.current;
    const outputSize = 200; // 最终输出 200x200

    // 计算裁剪区域的像素坐标
    const cropX = (crop.x / 100) * image.naturalWidth;
    const cropY = (crop.y / 100) * image.naturalHeight;
    const cropWidth = (crop.width / 100) * image.naturalWidth;
    const cropHeight = (crop.height / 100) * image.naturalHeight;

    // 创建白色背景画布
    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // 填充白色背景
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outputSize, outputSize);

    // 计算缩放比例，使裁剪区域填充整个输出
    const scale = Math.min(outputSize / cropWidth, outputSize / cropHeight);
    const scaledWidth = cropWidth * scale;
    const scaledHeight = cropHeight * scale;
    const offsetX = (outputSize - scaledWidth) / 2;
    const offsetY = (outputSize - scaledHeight) / 2;

    // 绘制裁剪区域并缩放（居中）
    ctx.drawImage(
      image,
      cropX, cropY, cropWidth, cropHeight,
      offsetX, offsetY, scaledWidth, scaledHeight
    );

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/png", 1);
    });
  };

  const handleUpload = async () => {
    if (uploading || !companyName || !crop?.width || !crop.height) return;
    setUploading(true);
    setError("");
    try {
      const blob = await getCroppedImage();
      if (!blob) throw new Error("无法生成图标，请重新选择图片。");

      const formData = new FormData();
      formData.append("company_name", companyName);
      formData.append("logo", blob, `${companyName.toLowerCase().replace(/\s+/g, "_")}.png`);

      const response = await fetch("/api/admin/company-logos", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "保存失败，请重试。");
      setSelection(null);
      setCrop(undefined);
      setNewCompanyName("");
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败，请重试。");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!uploading} className="max-h-[calc(100dvh-1rem)] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[28rem]">
        <DialogHeader className="gap-1.5 px-5 pt-5 pb-4 pr-12 text-left">
          <DialogTitle className="leading-6">{initialCompanyName ? "编辑企业图标" : "添加企业图标"}</DialogTitle>
          <DialogDescription>{initialCompanyName ? "选择新图片后，保存即可替换当前图标。" : "填写企业名称，再选择一张图片作为图标。"}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 space-y-3 overflow-y-auto px-5 pb-4">
          {initialCompanyName ? (
            <div className="flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5">
              <CompanyLogo company={initialCompanyName} logoUrl={currentLogoUrl} fallbackLogoUrl={fallbackLogoUrl} size="sm" />
              <div className="min-w-0">
                <p className="wrap-anywhere text-sm font-medium">{initialCompanyName}</p>
                <p className="text-xs text-muted-foreground">当前图标</p>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="logo-company-name">企业名称</Label>
              <Input
                id="logo-company-name"
                value={newCompanyName}
                onChange={(event) => setNewCompanyName(event.target.value)}
                placeholder="例如：AeroVironment"
                disabled={uploading}
              />
            </div>
          )}

          <input ref={inputRef} type="file" accept={supportedFileTypes} onChange={onSelectFile} hidden />
          {selection ? (
            <div className="space-y-2.5">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">新图标</p>
                  <p className="truncate text-xs text-muted-foreground" title={selection.name}>{selection.name}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>更换图片</Button>
              </div>
              <div className="flex justify-center overflow-hidden rounded-lg border bg-muted/40 p-2.5">
                <ReactCrop
                  className="min-w-0 max-w-full"
                  crop={crop}
                  onChange={(_, percentCrop) => setCrop(percentCrop)}
                  disabled={uploading}
                  keepSelection
                >
                  <img
                    ref={imgRef}
                    src={selection.url}
                    alt="新图标预览"
                    onLoad={onImageLoad}
                    onError={() => {
                      setSelection(null);
                      setCrop(undefined);
                      setError("无法读取这张图片，请重新选择。");
                    }}
                    className="h-auto max-h-52 w-auto max-w-full"
                  />
                </ReactCrop>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <p className="text-xs text-muted-foreground">默认保留整张图片，可拖动边框裁剪。</p>
                <button type="button" onClick={() => setCrop(fullImageCrop)} disabled={uploading || !crop || crop === fullImageCrop} className="text-xs font-medium text-primary hover:underline disabled:hidden">恢复整图</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => inputRef.current?.click()} className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed bg-muted/25 px-3 py-5 text-center transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring">
              <ImagePlus className="mb-0.5 size-5 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm font-medium">选择图片</span>
              <span className="text-xs text-muted-foreground">JPG、PNG、GIF、WebP、SVG</span>
            </button>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="flex-row items-center justify-end border-t bg-muted/20 px-5 py-3">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={uploading}>
            取消
          </Button>
          <Button type="button" onClick={handleUpload} disabled={uploading || !companyName || !crop?.width || !crop.height}>
            {uploading && <Loader2 className="animate-spin" aria-hidden="true" />}
            {uploading ? "保存中…" : "保存图标"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
