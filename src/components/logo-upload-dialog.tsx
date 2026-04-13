"use client";

import { useState, useRef } from "react";
import ReactCrop, { Crop, centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Plus, Upload, ZoomIn, ZoomOut, RotateCw, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LogoUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
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

export function LogoUploadDialog({ open, onOpenChange, onSuccess }: LogoUploadDialogProps) {
  const [companyName, setCompanyName] = useState("");
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<Crop>();
  const [uploading, setUploading] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setSrc(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    const crop = centerAspectCrop(width, height, 1);
    setCrop(crop);
  };

  const getCroppedImage = async (): Promise<Blob | null> => {
    if (!imgRef.current || !completedCrop) return null;

    const image = imgRef.current;
    const canvas = document.createElement("canvas");
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;

    canvas.width = completedCrop.width * scaleX;
    canvas.height = completedCrop.height * scaleY;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(
      image,
      completedCrop.x * scaleX,
      completedCrop.y * scaleY,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY,
      0,
      0,
      canvas.width,
      canvas.height
    );

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/png", 1);
    });
  };

  const handleUpload = async () => {
    if (!companyName || !completedCrop) {
      alert("请填写公司名称并选择裁剪区域");
      return;
    }

    setUploading(true);
    try {
      const blob = await getCroppedImage();
      if (!blob) {
        alert("裁剪失败");
        return;
      }

      const formData = new FormData();
      formData.append("company_name", companyName);
      formData.append("logo", blob, `${companyName.toLowerCase().replace(/\s+/g, "_")}.png`);

      const response = await fetch("/api/admin/company-logos", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        alert("Logo 上传成功！");
        handleClose();
        onSuccess();
      } else {
        alert(data.error || "上传失败");
      }
    } catch (error) {
      alert("上传失败");
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    setSrc(null);
    setCompanyName("");
    setCrop(undefined);
    setCompletedCrop(undefined);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>上传企业 Logo</DialogTitle>
          <DialogDescription>支持 JPG、PNG、GIF、WebP 格式，可裁剪至 1:1 正方形</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 步骤1: 选择文件 */}
          {!src ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="company">公司名称</Label>
                <Input
                  id="company"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="例如：Stripe"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="logo-file">选择图片</Label>
                <Input
                  id="logo-file"
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  onChange={onSelectFile}
                  className="mt-1"
                />
              </div>
            </div>
          ) : (
            /* 步骤2: 裁剪 */
            <div className="space-y-4">
              <div className="text-sm font-medium">拖拽调整裁剪区域（正方形）</div>
              
              <div className="border rounded-lg overflow-hidden bg-muted">
                <ReactCrop
                  crop={crop}
                  onChange={(_, percentCrop) => setCrop(percentCrop)}
                  onComplete={(c) => setCompletedCrop(c)}
                  aspect={1}
                  keepSelection
                >
                  <img
                    ref={imgRef}
                    src={src}
                    alt="Logo"
                    onLoad={onImageLoad}
                    className="max-h-[300px] w-auto mx-auto"
                  />
                </ReactCrop>
              </div>

              <p className="text-xs text-muted-foreground text-center">
                拖拽图片或裁剪框调整 Logo 区域
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row gap-2 sm:gap-2">
          <Button variant="outline" onClick={handleClose}>
            取消
          </Button>
          {src && (
            <Button variant="outline" onClick={() => setSrc(null)}>
              重新选择
            </Button>
          )}
          <Button onClick={handleUpload} disabled={uploading || !companyName || !completedCrop}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            <span className="ml-2">{uploading ? "上传中..." : "上传"}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
