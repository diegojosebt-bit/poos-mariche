// This file is required to use xlsx in TypeScript with moduleResolution: 'bundler'
// See: https://github.com/SheetJS/sheetjs/issues/2857
declare module 'xlsx' {
    import xlsx from 'xlsx/types';
    export * from 'xlsx/types';
    export default xlsx;
}
