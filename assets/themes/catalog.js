/* Public theme packs. The picker, stylesheet build and offline cache use this same list. */
(() => {
    const catalog = [
        {
            id: 'classic', name: '清新', description: '青绿色与轻盈的留白',
            lightTone: 'blue', supportsDecoration: false, styles: [], assets: []
        },
        {
            id: 'minimal', name: '极简', description: '只有黑、白和灰的安静界面',
            lightTone: 'white', supportsDecoration: false, styles: ['monochrome.css'], assets: []
        },
        {
            id: 'pixel', name: '像素掌机', description: '液晶屏、像素按键和一只背着时钟的蜗牛',
            lightTone: 'blue', supportsDecoration: true, styles: ['pixel.css', 'pages.css', 'preview.css'], assets: ['clocktrail.svg']
        }
    ];
    if (typeof module === 'object' && module.exports) module.exports = catalog;
    else window.TimerThemeCatalog = catalog;
})();
