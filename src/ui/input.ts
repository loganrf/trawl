// Keyboard state with per-frame "pressed" edges.

export class Input {
  private keys = new Set<string>();
  private just = new Set<string>();
  enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.just.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  down(code: string): boolean {
    return this.enabled && this.keys.has(code);
  }

  pressed(code: string): boolean {
    return this.enabled && this.just.has(code);
  }

  endFrame() {
    this.just.clear();
  }
}

function isTyping(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}
