"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import ReactCrop, { Crop, centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Upload, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LogoUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  initialCompanyName?: string;
}

function centerAspectCrop(mediaWidth: number, mediaHeight: number, aspect: number) {
  return centerCrop(
    makeAspectCrop(
      {
        unit: "%",
        width: 90,
      },
      aspect,
      mediaWidth,
      mediaHeight
    ),
    mediaWidth,
    mediaHeight
  );
}

export function LogoUploadDialog({ open, onOpenChange, onSuccess, initialCompanyName = "" }: LogoUploadDialogProps) {
  const [companyName, setCompanyName] = useState("");
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [uploading, setUploading] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (open) setCompanyName(initialCompanyName);
  }, [open, initialCompanyName]);

  // 监听 dialog 关闭，重置状态
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setSrc(null);
      setCompanyName("");
      setCrop(undefined);
      setUploading(false);
    }
    onOpenChange(isOpen);
  };

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setSrc(reader.result as string);
      setCrop(undefined);
    };
    reader.readAsDataURL(file);
  };

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    // 初始化为整个图片区域的 90%
    setCrop({
      unit: "%",
      x: 5,
      y: 5,
      width: 90,
      height: 90,
    });
  }, []);

  const getCroppedImage = async (): Promise<Blob | null> => {
    if (!imgRef.current || !crop || !imgRef.current.src) return null;

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
    if (!companyName.trim()) {
      alert("请填写公司名称");
      return;
    }
    if (!src || !crop) {
      alert("请先选择图片");
      return;
    }

    setUploading(true);
    try {
      const blob = await getCroppedImage();
      if (!blob) {
        alert("裁剪失败，请重试");
        setUploading(false);
        return;
      }

      const formData = new FormData();
      formData.append("company_name", companyName.trim());
      formData.append("logo", blob, `${companyName.toLowerCase().replace(/\s+/g, "_")}.png`);

      const response = await fetch("/api/admin/company-logos", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setUploading(false);
        handleClose();
        onSuccess();
      } else {
        alert(data.error || "上传失败");
        setUploading(false);
      }
    } catch (error) {
      console.error("Upload error:", error);
      alert("上传失败，请重试");
      setUploading(false);
    }
  };

  const handleClose = () => {
    handleOpenChange(false);
  };

  const handleReset = () => {
    setSrc(null);
    setCrop(undefined);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialCompanyName ? `替换 ${initialCompanyName} 的 Logo` : "上传企业 Logo"}</DialogTitle>
        <DialogDescription>支持 JPG、PNG、GIF、WebP、SVG 格式，裁剪为 1:1 正方形</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 步骤1: 填写信息 */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="company">公司名称</Label>
              <Input
                id="company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="例如：Stripe"
                disabled={Boolean(initialCompanyName)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="logo-file">选择 Logo 图片</Label>
              <Input
                id="logo-file"
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                onChange={onSelectFile}
                className="mt-1"
              />
            </div>
          </div>

          {/* 步骤2: 裁剪预览 */}
          {src && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">裁剪区域（可拖拽调整）</span>
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  重新选择
                </Button>
              </div>
              
              <div className="border rounded-lg overflow-hidden bg-muted/50 p-2">
                <ReactCrop
                  crop={crop}
                  onChange={(_, percentCrop) => setCrop(percentCrop)}
                  keepSelection
                >
                  <img
                    ref={imgRef}
                    src={src}
                    alt="Logo"
                    onLoad={onImageLoad}
                    className="max-h-[250px] w-auto mx-auto"
                  />
                </ReactCrop>
              </div>
              
              <p className="text-xs text-muted-foreground text-center">
                拖拽调整选择区域，选中内容会自动缩放填充为正方形（留白补齐）
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row gap-2 sm:gap-2">
          <Button variant="outline" onClick={handleClose}>
            取消
          </Button>
          <Button 
            onClick={handleUpload} 
            disabled={uploading || !companyName.trim() || !src}
            className="w-full"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="ml-2">上传中...</span>
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                <span className="ml-2">上传 Logo</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
