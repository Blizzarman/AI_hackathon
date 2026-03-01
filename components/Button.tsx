"use client";

import { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger";

type CommonProps = {
  children: ReactNode;
  className?: string;
  variant?: ButtonVariant;
};

type LinkProps = CommonProps &
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
  };

type NativeButtonProps = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: undefined;
  };

type ButtonProps = LinkProps | NativeButtonProps;

function buttonClassName(variant: ButtonVariant, className?: string) {
  const base =
    variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : "btn-secondary";
  return `btn ${base} ${className ?? ""}`.trim();
}

export default function Button(props: ButtonProps) {
  const variant = props.variant ?? "primary";
  const className = buttonClassName(variant, props.className);

  if ("href" in props && typeof props.href === "string") {
    const { children, href, className: _className, variant: _variant, ...rest } = props;
    return (
      <a href={href} className={className} {...rest}>
        {children}
      </a>
    );
  }

  const { children, className: _className, variant: _variant, type, ...rest } = props;
  return (
    <button type={type ?? "button"} className={className} {...rest}>
      {children}
    </button>
  );
}
