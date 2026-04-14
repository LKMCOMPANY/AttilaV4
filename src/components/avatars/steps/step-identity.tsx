"use client";

import { useState } from "react";
import Image from "next/image";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { User, Mail, Phone, ImagePlus } from "lucide-react";
import type { StepProps } from "../types";

export function StepIdentity({ data, onChange }: StepProps) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h3 className="text-heading-3">Identity</h3>
        <p className="text-body-sm text-muted-foreground">
          Define the avatar's name and contact information.
        </p>
      </div>

      {/* Name fields */}
      <fieldset className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="avatar-first-name" className="text-label">
              <User className="mr-1.5 inline h-3.5 w-3.5" />
              First Name
              <span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="avatar-first-name"
              placeholder="John"
              value={data.first_name}
              onChange={(e) => onChange({ first_name: e.target.value })}
              aria-required
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="avatar-last-name" className="text-label">
              Last Name
              <span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="avatar-last-name"
              placeholder="Doe"
              value={data.last_name}
              onChange={(e) => onChange({ last_name: e.target.value })}
              aria-required
              autoComplete="off"
            />
          </div>
        </div>
      </fieldset>

      {/* Profile image */}
      <div className="space-y-2">
        <Label htmlFor="avatar-profile-image" className="text-label">
          <ImagePlus className="mr-1.5 inline h-3.5 w-3.5" />
          Profile Image URL
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">optional</span>
        </Label>
        <Input
          id="avatar-profile-image"
          type="url"
          placeholder="https://example.com/photo.jpg"
          value={data.profile_image_url}
          onChange={(e) => {
            setImgError(false);
            onChange({ profile_image_url: e.target.value });
          }}
          autoComplete="off"
        />
        {data.profile_image_url && !imgError && (
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <Image
              src={data.profile_image_url}
              alt="Avatar preview"
              width={48}
              height={48}
              className="h-12 w-12 rounded-full border object-cover"
              unoptimized
              onError={() => setImgError(true)}
            />
            <span className="text-sm text-muted-foreground">Preview</span>
          </div>
        )}
      </div>

      {/* Contact */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="avatar-email" className="text-label">
            <Mail className="mr-1.5 inline h-3.5 w-3.5" />
            Email
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">optional</span>
          </Label>
          <Input
            id="avatar-email"
            type="email"
            placeholder="john@example.com"
            value={data.email}
            onChange={(e) => onChange({ email: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="avatar-phone" className="text-label">
            <Phone className="mr-1.5 inline h-3.5 w-3.5" />
            Phone
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">optional</span>
          </Label>
          <Input
            id="avatar-phone"
            type="tel"
            placeholder="+1 234 567 890"
            value={data.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            autoComplete="off"
          />
        </div>
      </div>
    </div>
  );
}
