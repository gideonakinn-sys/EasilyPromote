"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { useIsMobile } from "../hooks/use-is-mobile";

interface MobileDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function MobileDrawer({ open, onOpenChange, children }: MobileDrawerProps) {
  const isMobile = useIsMobile();
  const [keyboardHeight, setKeyboardHeight] = React.useState(0);

  React.useEffect(() => {
    if (!open) {
      setKeyboardHeight(0);
      return;
    }

    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      setKeyboardHeight(Math.max(0, window.innerHeight - vv.height));
    };

    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, [open]);

  if (!isMobile) return null;

  return (
    <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} direction="bottom">
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-neutral-900/40 backdrop-blur-sm" />
        <DrawerPrimitive.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-white px-4 py-6 outline-none max-h-[70vh] overflow-y-auto"
          style={{ bottom: keyboardHeight }}
        >
          <div className="w-10 h-1 bg-neutral-300 rounded-full mx-auto mb-4 flex-shrink-0" />
          <div className="flex flex-col gap-2">
            {children}
          </div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
