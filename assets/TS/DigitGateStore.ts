import { DigitGateSettings } from './DigitGateRules';

// 与指定参考 savedog_complete.JumpToStore 保持相同接口顺序和系统判断。
// SDK 自行接管时不传 URL；MRAID 和普通浏览器读取工作台中的地址。
export function jumpToStore(settings: Pick<DigitGateSettings, 'storeUrls'>, browser: any = globalThis) {
    try {
        if (typeof browser.ExitApi?.exit === 'function') { browser.ExitApi.exit(); return; }
        if (typeof browser.FbPlayableAd?.onCTAClick === 'function') { browser.FbPlayableAd.onCTAClick(); return; }
        if (typeof browser.openAppStore === 'function') { browser.openAppStore(); return; }
        const ua = browser.navigator?.userAgent || '';
        const isAndroid = /android/i.test(ua), isIOS = /iphone|ipad|ipod/i.test(ua);
        const url = isAndroid ? settings.storeUrls.android : isIOS ? settings.storeUrls.ios : settings.storeUrls.android;
        if (typeof browser.mraid?.open === 'function') { browser.mraid.open(url); return; }
        browser.open(url, '_blank');
    } catch (e) {
        console.error('跳转商店异常:', e);
        browser.alert('跳转失败，请稍后再试。');
    }
}
