"use client";

import { useState, useRef, useCallback } from "react";
import Cropper, { ReactCropperElement } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { X, ZoomIn, ZoomOut, RotateCw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LogoUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function LogoUploadDialog({ open, onOpenChange, onSuccess }: LogoUploadDialogProps) {
  const [companyName, setCompanyName] = useState("");
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [completedCrop, setCompletedCrop] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const cropperRef = useRef<ReactCropperElement>(null);

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setSrc(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const getCroppedImage = useCallback(() => {
    if (!cropperRef.current || !completedCrop) return null;

    const canvas = document.createElement("canvas");
    const image = imgRef.current;
    if (!image) return null;

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

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (blob) => {
          resolve(blob);
        },
        "image/png",
        1
      );
    });
  }, [completedCrop]);

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
    setCrop({ x: 0, y: 0 });
    setCompletedCrop(null);
    setZoom(1);
    onOpenChange(false);
  };

  const handleZoomIn = () => {
    setZoom((z) => Math.min(z + 0.25, 3));
    cropperRef.current?.cropper?.zoom(0.25);
  };

  const handleZoomOut = () => {
    setZoom((z) => Math.max(z - 0.25, 0.5));
    cropperRef.current?.cropper?.zoom(-0.25);
  };

  const handleRotate = () => {
    cropperRef.current?.cropper?.rotate(90);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>上传企业 Logo</DialogTitle>
          <DialogDescription>支持 JPG、PNG、GIF、WebP 格式，可裁剪至合适比例</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 步骤1: 选择文件 */}
          {!src && (
            <div>
              <Label htmlFor="company">公司名称</Label>
              <Input
                id="company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="例如：Stripe"
                className="mt-1 mb-4"
              />
              <Label htmlFor="logo-file" className="cursor-pointer">
                <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors">
                  <p className="text-muted-foreground">点击选择图片文件</p>
                  <p className="text-sm text-muted-foreground mt-1">或拖拽文件到此处</p>
                </div>
                <Input
                  id="logo-file"
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  onChange={onSelectFile}
                  className="hidden"
                />
              </Label>
            </div>
          )}

          {/* 步骤2: 裁剪 */}
          {src && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">裁剪 Logo</span>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleZoomOut}>
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={handleZoomIn}>
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={handleRotate}>
                    <RotateCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="relative h-[300px] bg-muted rounded-lg overflow-hidden">
                <Cropper
                  ref={cropperRef}
                  src={src}
                  style={{ height: "100%", width: "100%" }}
                  aspectRatio={1}
                  viewMode={1}
                  dragMode="move"
                  guides={true}
                  crop={({ x, y }) => setCrop({ x, y })}
                  onInitialized={(instance) => {
                    imgRef.current = instance.imageDom;
                  }}
                  onCropChange={setCrop}
                  onCropComplete={(_, percentage) => {
                    // 计算裁剪框
                    const cropBoxData = instance?.getCropBoxData?.();
                    if (cropBoxData) {
                      setCompletedCrop({
                        x: cropBoxData.left,
                        y: cropBoxData.top,
                        width: cropBoxData.width,
                        height: cropBoxData.height,
                      });
                    }
                  }}
                />
              </div>

              <p className="text-xs text-muted-foreground text-center">
                拖拽移动图片，调整裁剪框到合适区域
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
            {uploading ? "上传中..." : "上传"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
