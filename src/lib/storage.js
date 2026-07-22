import {ScratchStorage} from 'scratch-storage';

import defaultProject from './default-project';

/**
 * Wrapper for ScratchStorage which adds default web sources.
 * @todo make this more configurable
 */
class Storage extends ScratchStorage {
    constructor () {
        super();
        this.cacheDefaultProject();
        this.disableFetchWorker();
    }
    // KidsBoard: scratch-storage は既定でアセット取得を Web Worker(FetchWorkerTool)
    // 経由で行うが、このビルドでは worker が応答せず fetch が永久にハングする。
    // その結果、ライブラリからスプライト/コスチューム/背景/音を選んでも addSprite 等が
    // 完了せず「選んでも何も追加されない・エラーも出ない」状態になっていた。
    // (デフォルトプロジェクトの素材は BuiltinHelper のメモリキャッシュから取るため無影響で、
    //  ライブラリ素材=web fetch だけが固まっていた)。
    // ProxyTool はツールがハングしたとき次へフォールバックしない(拒否時のみ)ため、
    // worker ツールを外してメインスレッドの FetchTool だけを使うようにする。
    // 素材取得はクリック都度なので、ワーカーを使わない性能影響は無視できる。
    disableFetchWorker () {
        const assetTool = this.webHelper && this.webHelper.assetTool;
        if (!assetTool || !Array.isArray(assetTool.tools)) return;
        // FetchWorkerTool は worker を内包する(inner/worker プロパティを持つ)。
        // それらを外し、メインスレッドの FetchTool(プロパティ無し)だけを残す。
        const mainThreadTools = assetTool.tools.filter(tool =>
            tool && !('inner' in tool) && !('worker' in tool)
        );
        if (mainThreadTools.length > 0) {
            assetTool.tools = mainThreadTools;
        }
    }
    addOfficialScratchWebStores () {
        this.addWebStore(
            [this.AssetType.Project],
            this.getProjectGetConfig.bind(this),
            this.getProjectCreateConfig.bind(this),
            this.getProjectUpdateConfig.bind(this)
        );
        // KidsBoard: ライブラリのアセットは自サイトに同梱した static/library-assets/ を
        // 最優先で参照する。Scratch公式CDN(assets.scratch.mit.edu)に繋がらない環境
        // (学校ネット等)でもスプライト/コスチューム/背景/音の選択が動くようにするため。
        // ここに無いアセット(自作プロジェクトの読み込み等)は下のCDNストアへフォールバックする。
        this.addWebStore(
            [this.AssetType.ImageVector, this.AssetType.ImageBitmap, this.AssetType.Sound],
            this.getLocalAssetGetConfig.bind(this)
        );
        this.addWebStore(
            [this.AssetType.ImageVector, this.AssetType.ImageBitmap, this.AssetType.Sound],
            this.getAssetGetConfig.bind(this),
            // We set both the create and update configs to the same method because
            // storage assumes it should update if there is an assetId, but the
            // asset store uses the assetId as part of the create URI.
            this.getAssetCreateConfig.bind(this),
            this.getAssetCreateConfig.bind(this)
        );
        this.addWebStore(
            [this.AssetType.Sound],
            asset => `static/extension-assets/scratch3_music/${asset.assetId}.${asset.dataFormat}`
        );
    }
    setProjectHost (projectHost) {
        this.projectHost = projectHost;
    }
    setProjectToken (projectToken) {
        this.projectToken = projectToken;
    }
    getProjectGetConfig (projectAsset) {
        const path = `${this.projectHost}/${projectAsset.assetId}`;
        const qs = this.projectToken ? `?token=${this.projectToken}` : '';
        return path + qs;
    }
    getProjectCreateConfig () {
        return {
            url: `${this.projectHost}/`,
            withCredentials: true
        };
    }
    getProjectUpdateConfig (projectAsset) {
        return {
            url: `${this.projectHost}/${projectAsset.assetId}`,
            withCredentials: true
        };
    }
    setAssetHost (assetHost) {
        this.assetHost = assetHost;
    }
    // KidsBoard: 同梱アセットへの同一オリジンURL。
    // GETはWeb Worker経由で走ることがあり、worker内では相対パスがworker自身の
    // URL基準(static/js/)で解決されてしまうため、ページURLを基準に絶対URL化する。
    // ファイルが無ければ 404 になり、storage が次のストア(CDN)へフォールバックする。
    getLocalAssetGetConfig (asset) {
        const relative = `static/library-assets/${asset.assetId}.${asset.dataFormat}`;
        if (typeof window !== 'undefined' && window.location && window.location.href) {
            return new URL(relative, window.location.href).href;
        }
        return relative;
    }
    getAssetGetConfig (asset) {
        return `${this.assetHost}/internalapi/asset/${asset.assetId}.${asset.dataFormat}/get/`;
    }
    getAssetCreateConfig (asset) {
        return {
            // There is no such thing as updating assets, but storage assumes it
            // should update if there is an assetId, and the asset store uses the
            // assetId as part of the create URI. So, force the method to POST.
            // Then when storage finds this config to use for the "update", still POSTs
            method: 'post',
            url: `${this.assetHost}/${asset.assetId}.${asset.dataFormat}`,
            withCredentials: true
        };
    }
    setTranslatorFunction (translator) {
        this.translator = translator;
        this.cacheDefaultProject();
    }
    cacheDefaultProject () {
        const defaultProjectAssets = defaultProject(this.translator);
        defaultProjectAssets.forEach(asset => this.builtinHelper._store(
            this.AssetType[asset.assetType],
            this.DataFormat[asset.dataFormat],
            asset.data,
            asset.id
        ));
    }
}

const storage = new Storage();

export default storage;
