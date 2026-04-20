import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  declare props: Props;
  declare state: State;
  declare setState: React.Component<Props, State>['setState'];

  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Render error:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);

    return (
      <div className="max-w-xl mx-auto mt-12 p-8 bg-white rounded-3xl border border-red-100 shadow-sm text-center">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="text-red-500" size={32} />
        </div>
        <h2 className="text-2xl font-bold text-[#141414] mb-2">Something went wrong</h2>
        <p className="text-[#141414]/60 mb-6">
          Your data is safe. This view hit an unexpected error — reload to try again.
        </p>
        <p className="text-xs font-mono text-[#141414]/40 mb-6 break-all">
          {this.state.error.message}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={this.reset}
            className="px-6 py-3 bg-[#141414]/5 text-[#141414] rounded-xl font-bold hover:bg-[#141414]/10 transition-all flex items-center gap-2"
          >
            <RotateCcw size={16} /> Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-[#141414] text-white rounded-xl font-bold hover:bg-[#141414]/90 transition-all"
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }
}
