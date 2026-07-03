/**
 * Vitest setup 文件
 *
 * 加载 @testing-library/jest-dom 的自定义匹配器（toBeInTheDocument 等）。
 * 补充 jsdom 缺失的 DOM API mock。
 */
import "@testing-library/jest-dom/vitest";

// jsdom 未实现 scrollIntoView，ChatArea 的 useEffect 会调用它
Element.prototype.scrollIntoView = vi.fn();

import { vi } from "vitest";
