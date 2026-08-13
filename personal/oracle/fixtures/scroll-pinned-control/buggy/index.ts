export interface Rect {
  top: number;
  bottom: number;
}

export interface Layout {
  control: Rect;
  content: Rect[];
}

const CONTROL_HEIGHT = 40;
const ITEM_HEIGHT = 60;
const VIEWPORT_HEIGHT = 300;
const ITEM_COUNT = 12;

export function layout(scrollTop: number): Layout {
  const control: Rect = { top: 8, bottom: 8 + CONTROL_HEIGHT };
  const content: Rect[] = [];
  for (let i = 0; i < ITEM_COUNT; i++) {
    const top = i * ITEM_HEIGHT - scrollTop;
    content.push({ top, bottom: top + ITEM_HEIGHT });
  }
  return { control, content };
}

export function overlapsControl(scrollTop: number): boolean {
  const { control, content } = layout(scrollTop);
  return content.some(item => {
    const visible = item.bottom > 0 && item.top < VIEWPORT_HEIGHT;
    return visible && item.top < control.bottom && item.bottom > control.top;
  });
}
