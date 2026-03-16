// Allow importing audio assets
declare module '*.wav' {
  const src: string;
  export default src;
}
