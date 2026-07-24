// htm을 preact/compat createElement에 바인딩 — 프로토타입(dc-runtime=React 기반)과
// 동일한 이벤트 의미론(onChange=input 등)과 defaultValue/defaultChecked를 유지한다.
import htm from 'htm';
import { createElement } from 'preact/compat';

export const html = htm.bind(createElement);
