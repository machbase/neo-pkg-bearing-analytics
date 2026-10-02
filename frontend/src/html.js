// htm을 preact/compat createElement에 바인딩 — React식 이벤트 의미론(onChange=input 등)·defaultValue/defaultChecked 유지
import htm from 'htm';
import { createElement } from 'preact/compat';

export const html = htm.bind(createElement);
