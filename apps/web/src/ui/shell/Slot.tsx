// Error boundary around every mounted track component: one crashing panel must not blank the whole app.
import { Component, type ReactNode } from 'react';

interface Props { name: string; children?: ReactNode }
interface State { failed: boolean }

export class Slot extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
