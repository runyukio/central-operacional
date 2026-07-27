import { QUEUE_METADATA, type QueueLob, type QueueMetadata } from "@/lib/queue-metadata";

export const QUEUE_DICTIONARY: Record<string, string> = {
  "600003278": "Drama Revisão de segurança Barris brasileiros Inicial",
  "600002381": "私信图片标注",
  "600002377": "私信文本标注",
  "600001812": "push文案审核_巴西桶_紧急热点",
  "600001428": "push文案审核_巴西桶_热点",
  "8572": "push文案审核_巴西桶_重复",
  "8571": "push文案审核_巴西桶_召回",
  "6992": "push文案审核_巴西桶_top",
  "5487": "push文案审核_巴西桶_活动热点",
  "5486": "push文案审核_巴西桶_初始",
  "600001322": "评论分级标注_巴西桶_TrainingDataCheck",
  "600001317": "评论分级标注_巴西桶_Accuracy_RecallCheck",
  "600001312": "评论分级标注_巴西桶_ModelAccuracy",
  "600001311": "评论分级标注_巴西桶_ImageCommentCheck",
  "600001306": "评论分级标注_巴西桶_SensitiveWord",
  "600001305": "评论分级标注_巴西桶_专家质检",
  "600001300": "评论分级标注_巴西桶_质检",
  "600001295": "评论分级标注_巴西桶_大盘标注",
  "600001276": "用户申诉_巴西桶_未成年",
  "600001275": "用户申诉_巴西桶_初始",
  "600001260": "用户举报_巴西桶_语言",
  "600001228": "用户举报_巴西桶_初始",
  "600001241": "用户一审_巴西桶_未成年专审",
  "600001240": "用户一审_巴西桶_直播专审",
  "600001239": "用户一审_巴西桶_专审",
  "600001237": "用户一审_巴西桶_召回",
  "600001227": "用户一审_巴西桶_初始",
  "600001199": "CommentReport_Br_FirstCategory",
  "600000970": "私信_举报审_巴西桶_默认",
  "600000968": "私信_举报审_混合桶_默认",
  "600000615": "私信_举报审_巴西桶_语音私信",
  "600000922": "用户_未成年年龄修改验证_巴西桶_初始",
  "14198": "商业化-录播放映厅视频-巴西桶-混合",
  "14221": "没有名字",
  "14222": "没有名字",
  "14108": "没有名字",
  "13461": "商业化-达人广告unit-巴西桶-初始",
  "13328": "商业化-效果召回-巴西桶-二确",
  "11149": "商业化-效果召回-巴西桶-AIGC",
  "9704": "商业化-效果召回-巴西桶-标注",
  "9115": "商业化-效果召回-秘鲁桶-高热",
  "8831": "商业化-效果召回-通投桶-高热",
  "8817": "商业化-效果召回-哥伦比亚桶-高热",
  "8816": "商业化-效果召回-墨西哥桶-高热",
  "8815": "商业化-效果召回-阿根廷桶-高热",
  "8813": "商业化-效果召回-巴西桶-高热",
  "13222": "商业化-快任务视频素材-巴西桶-初始",
  "13169": "直播_切片审_主播_巴西_KCM",
  "12884": "商业化-图片素材-巴西桶-初始",
  "11917": "商业化-小铃铛-通投桶-无行业",
  "11915": "商业化-小铃铛-秘鲁桶-无行业",
  "11911": "商业化-小铃铛-阿根廷桶-无行业",
  "11910": "商业化-小铃铛-哥伦比亚桶-无行业",
  "11909": "商业化-小铃铛-墨西哥桶-无行业",
  "11907": "商业化-小铃铛-巴西桶-无行业",
  "11906": "商业化-小铃铛-通投桶-初始",
  "11904": "商业化-小铃铛-秘鲁桶-初始",
  "11898": "商业化-小铃铛-阿根廷桶-初始",
  "11897": "商业化-小铃铛-哥伦比亚桶-初始",
  "11764": "商业化-小铃铛-墨西哥桶-初始",
  "11762": "商业化-小铃铛-巴西桶-初始",
  "11364": "视频_安全二审_巴西桶_FC回送",
  "5860": "视频_安全二审_巴西桶_语言",
  "11272": "商业化-落地页-秘鲁桶-初始",
  "11268": "商业化-落地页-通投桶-初始",
  "11267": "商业化-落地页-阿根廷桶-初始",
  "11266": "商业化-落地页-哥伦比亚桶-初始",
  "11265": "商业化-落地页-墨西哥桶-初始",
  "11239": "商业化-落地页-巴西桶-初始",
  "11151": "商业化-素材举报-巴西桶-AIGC",
  "9105": "商业化-素材举报-秘鲁桶-初始",
  "7592": "商业化-素材举报-通投桶-初始",
  "7591": "商业化-素材举报-阿根廷桶-初始",
  "7590": "商业化-素材举报-哥伦比亚桶-初始",
  "7589": "商业化-素材举报-墨西哥桶-初始",
  "7587": "商业化-素材举报-巴西桶-初始",
  "11147": "商业化-素材申诉-巴西桶-AIGC",
  "9702": "商业化-素材申诉-秘鲁桶-初始",
  "9698": "商业化-素材申诉-通投桶-初始",
  "9697": "商业化-素材申诉-阿根廷桶-初始",
  "9696": "商业化-素材申诉-哥伦比亚桶-初始",
  "9695": "商业化-素材申诉-墨西哥桶-初始",
  "9693": "商业化-素材申诉-巴西桶-初始",
  "11145": "商业化-效果广告-巴西桶-AIGC",
  "9643": "商业化-效果广告-秘鲁桶-初始",
  "9626": "商业化-效果广告-通投桶-top客户",
  "9623": "商业化-效果广告-通投桶-初始",
  "9621": "商业化-效果广告-阿根廷桶-top客户",
  "9618": "商业化-效果广告-阿根廷桶-初始",
  "9615": "商业化-效果广告-哥伦比亚桶-top客户",
  "9612": "商业化-效果广告-哥伦比亚桶-初始",
  "9610": "商业化-效果广告-墨西哥桶-top客户",
  "9607": "商业化-效果广告-墨西哥桶-初始",
  "9599": "商业化-效果广告-巴西桶-top客户",
  "9596": "商业化-效果广告-巴西桶-初始",
  "10886": "商业化-合约信息流unit-秘鲁桶-无行业",
  "10885": "商业化-合约信息流unit-阿根廷桶-无行业",
  "10882": "商业化-合约信息流unit-哥伦比亚桶-无行业",
  "10881": "商业化-合约信息流unit-墨西哥桶-无行业",
  "10878": "商业化-合约信息流unit-巴西桶-无行业",
  "9050": "商业化-合约信息流unit-秘鲁桶-初始",
  "9049": "商业化-合约信息流unit-阿根廷桶-初始",
  "9046": "商业化-合约信息流unit-哥伦比亚桶-初始",
  "9045": "商业化-合约信息流unit-墨西哥桶-初始",
  "8797": "商业化-合约信息流unit-巴西桶-初始",
  "10877": "商业化-开屏广告unit-秘鲁桶-无行业",
  "10874": "商业化-开屏广告unit-阿根廷桶-无行业",
  "10873": "商业化-开屏广告unit-哥伦比亚桶-无行业",
  "10872": "商业化-开屏广告unit-墨西哥桶-无行业",
  "10869": "商业化-开屏广告unit-巴西桶-无行业",
  "9038": "商业化-开屏广告unit-秘鲁桶-初始",
  "8793": "商业化-开屏广告unit-阿根廷桶-初始",
  "8792": "商业化-开屏广告unit-哥伦比亚桶-初始",
  "8791": "商业化-开屏广告unit-墨西哥桶-初始",
  "8788": "商业化-开屏广告unit-巴西桶-初始",
  "10820": "商业化-效果广告unit-秘鲁桶-无行业",
  "10816": "商业化-效果广告unit-通投桶-无行业",
  "10815": "商业化-效果广告unit-阿根廷桶-无行业",
  "10814": "商业化-效果广告unit-哥伦比亚桶-无行业",
  "10813": "商业化-效果广告unit-墨西哥桶-无行业",
  "10811": "商业化-效果广告unit-巴西桶-无行业",
  "9093": "商业化-效果广告unit-秘鲁桶-初始",
  "7968": "商业化-效果广告unit-通投桶-初始",
  "7967": "商业化-效果广告unit-阿根廷桶-初始",
  "7966": "商业化-效果广告unit-哥伦比亚桶-初始",
  "7965": "商业化-效果广告unit-墨西哥桶-初始",
  "7963": "商业化-效果广告unit-巴西桶-初始",
  "10810": "商业化-资质审核-阿根廷桶-无行业",
  "10809": "商业化-资质审核-哥伦比亚桶-无行业",
  "10808": "商业化-资质审核-墨西哥桶-无行业",
  "10807": "商业化-资质审核-通用桶-无行业",
  "10806": "商业化-资质审核-美国桶-无行业",
  "10805": "商业化-资质审核-白俄罗斯桶-无行业",
  "10804": "商业化-资质审核-香港桶-无行业",
  "10803": "商业化-资质审核-中国桶-无行业",
  "10802": "商业化-资质审核-新加坡桶-无行业",
  "10801": "商业化-资质审核-巴西桶-无行业",
  "5655": "商业化-资质审核-阿根廷桶-初始",
  "5654": "商业化-资质审核-哥伦比亚桶-初始",
  "5653": "商业化-资质审核-墨西哥桶-初始",
  "4118": "商业化-资质审核-美国桶-初始",
  "4119": "商业化-资质审核-通用桶-初始",
  "4117": "商业化-资质审核-白俄罗斯-初始",
  "4116": "商业化-资质审核-香港桶-初始",
  "4115": "商业化-资质审核-中国-初始",
  "4114": "商业化-资质审核-新加坡桶-初始",
  "3922": "商业化-资质审核-巴西桶-初始",
  "10215": "商业化-召回-巴西桶-大盘标注",
  "9849": "商业化-巡检-秘鲁桶-不一致",
  "9845": "商业化-巡检-通投桶-不一致",
  "9844": "商业化-巡检-阿根廷桶-不一致",
  "9843": "商业化-巡检-哥伦比亚桶-不一致",
  "9842": "商业化-巡检-墨西哥桶-不一致",
  "9840": "商业化-巡检-巴西桶-不一致",
  "9692": "商业化-合约信息流-秘鲁桶-初始",
  "9691": "商业化-合约信息流-阿根廷桶-初始",
  "9688": "商业化-合约信息流-哥伦比亚桶-初始",
  "9687": "商业化-合约信息流-墨西哥桶-初始",
  "9684": "商业化-合约信息流-巴西桶-初始",
  "9553": "视频_举报审_巴西桶_语言",
  "9551": "视频_举报审_巴西桶_临时屏蔽",
  "9550": "视频_举报审_巴西桶_多次举报",
  "9124": "商业化-广告组申诉-秘鲁桶-初始",
  "7699": "商业化-广告组申诉-通投桶-初始",
  "7698": "商业化-广告组申诉-阿根廷桶-初始",
  "7697": "商业化-广告组申诉-哥伦比亚桶-初始",
  "7696": "商业化-广告组申诉-墨西哥桶-初始",
  "7694": "商业化-广告组申诉-巴西桶-初始",
  "9037": "商业化-开屏广告-秘鲁桶-初始",
  "8595": "商业化-开屏广告-阿根廷桶-初始",
  "8594": "商业化-开屏广告-哥伦比亚桶-初始",
  "8593": "商业化-开屏广告-墨西哥桶-初始",
  "8587": "商业化-开屏广告-巴西桶-初始",
  "7716": "商业化-DPA商品举报-默认",
  "7703": "商业化-DPA商品-默认",
  "7338": "视频_申诉一审_巴西桶_语言",
  "6376": "语音直播_举报审_巴西桶_嘉宾",
  "6375": "语音直播_举报审_巴西桶_主播",
  "6247": "直播_举报审_巴西桶_主播",
  "5130": "kwai家族审核_巴西桶_编辑",
  "5121": "kwai家族审核_巴西桶_初始",
  "3701": "ug二审_巴西桶_初始",
  "2538": "ug素材审核_巴西桶_初始"
};

export function normalizeQueueId(value?: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized || "";
}

function normalizeQueueName(value?: string | null) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

const QUEUE_NAME_TO_ID = Object.entries(QUEUE_DICTIONARY).reduce<Record<string, string>>((acc, [queueId, queueName]) => {
  const normalizedName = normalizeQueueName(queueName);
  if (normalizedName && !acc[normalizedName]) acc[normalizedName] = queueId;
  return acc;
}, {});

export function getQueueNameById(queueId?: string | null) {
  const normalizedQueueId = normalizeQueueId(queueId);
  if (!normalizedQueueId) return "Sem Fila ID";
  return QUEUE_DICTIONARY[normalizedQueueId] ?? "Fila não mapeada";
}

export function getQueueMetadataById(queueId?: string | null): QueueMetadata {
  const normalizedQueueId = normalizeQueueId(queueId);
  return normalizedQueueId && QUEUE_METADATA[normalizedQueueId]
    ? QUEUE_METADATA[normalizedQueueId]
    : { lob: "N/A", slaTargetMinutes: null };
}

export function getQueueIdByName(queueName?: string | null) {
  const normalizedQueueName = normalizeQueueName(queueName);
  return normalizedQueueName ? QUEUE_NAME_TO_ID[normalizedQueueName] ?? "" : "";
}

export function resolveQueueReference(queueId?: string | null, queueName?: string | null) {
  const normalizedQueueId = normalizeQueueId(queueId);
  if (normalizedQueueId) {
    const metadata = getQueueMetadataById(normalizedQueueId);
    return {
      queueId: normalizedQueueId,
      queueName: getQueueNameById(normalizedQueueId),
      lob: metadata.lob,
      slaTargetMinutes: metadata.slaTargetMinutes
    };
  }

  const possibleQueueId = normalizeQueueId(queueName);
  if (possibleQueueId && QUEUE_DICTIONARY[possibleQueueId]) {
    const metadata = getQueueMetadataById(possibleQueueId);
    return {
      queueId: possibleQueueId,
      queueName: getQueueNameById(possibleQueueId),
      lob: metadata.lob,
      slaTargetMinutes: metadata.slaTargetMinutes
    };
  }

  const queueIdFromName = getQueueIdByName(queueName);
  if (queueIdFromName) {
    const metadata = getQueueMetadataById(queueIdFromName);
    return {
      queueId: queueIdFromName,
      queueName: getQueueNameById(queueIdFromName),
      lob: metadata.lob,
      slaTargetMinutes: metadata.slaTargetMinutes
    };
  }

  return {
    queueId: "",
    queueName: normalizeQueueName(queueName) || "Sem Fila ID",
    lob: "N/A" as QueueLob,
    slaTargetMinutes: null
  };
}
