/**
 * Report-only React error boundary (D-203 §2). The fallback is caller-provided: the
 * framework ships no user-facing strings here (the app owns its UI and its t() keys).
 * Without a fallback prop the boundary renders null and only reports.
 */
import { Component } from "react";
import type { ReactNode } from "react";
import { captureRumError } from "./errors.ts";

export interface RumErrorBoundaryProps {
  readonly children?: ReactNode;
  readonly fallback?: ReactNode;
}

interface RumErrorBoundaryState {
  readonly hasError: boolean;
}

export class RumErrorBoundary extends Component<RumErrorBoundaryProps, RumErrorBoundaryState> {
  override state: RumErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RumErrorBoundaryState {
    return { hasError: true };
  }

  // React's errorInfo.componentStack is deliberately ignored: a PII carrier, never recorded.
  override componentDidCatch(error: unknown): void {
    captureRumError(error, "react-boundary");
  }

  override render(): ReactNode {
    return this.state.hasError ? (this.props.fallback ?? null) : this.props.children;
  }
}
