# 数据来源与整理规则

资料快照为 **2026-11-02 的《闪耀！优俊少女》国服**。数据已随应用离线打包，不会运行时联网更新。

- 87 位可养成角色，不把不同衣装统计为独立角色。
- 155 种 G1～G3 奖杯：G1 35、G2 44、G3 76。
- 216 个举办日期，同一奖杯跨年重复举办只统计一座。
- 149 条已实装衣装目标路线，仅用于校对固定目标；收藏进度始终归属马娘本人。
- 394 张离线图片：87 张角色头像、155 张奖杯、152 张赛事横幅。

原始快照、整理后的 JSON 和表格位于 `outputs/character-research`、`outputs/race-research` 和 `outputs/syyjsn-20261102`；程序内目录为 `app/public/catalog.json`，可复现的整理程序为 `scripts/prepare-data.py`。

角色范围结合 [国服卡池记录](https://wiki.biligame.com/umamusume/简中卡池)、[国服角色图鉴](https://wiki.biligame.com/umamusume/简中赛马娘图鉴)和官方公告整理，排除资料站的预收录角色。最新圣诞目白善信、目白光明衣装仅增加目标路线，不增加角色数。

赛事及图片主要来自 [BWIKI 赛事资料](https://wiki.biligame.com/umamusume/比赛)、[BWIKI 奖杯资料](https://wiki.biligame.com/umamusume/奖杯)；每项赛事的实际来源 URL、原始图片 URL 均保留在目录中。葵锦标的 G3 奖杯图使用 GameWith 的公开图片。角色头像、奖杯和横幅归原权利方所有，本项目为非官方辅助工具。

奖杯陈列顺序采用[公开游戏主数据快照](https://github.com/SimpleSandman/UmaMusumeMetaMasterMDB/blob/master/master/master.mdb)的 `race_trophy.disp_order`，不再按赛事编号排序；保留国服目录的 155 项，海外三赛映射到现有稳定赛事 ID。映射表及原数据库 SHA-256 保存在 `app/public/trophy-order.json`，用 `python scripts/trophy-order.py` 可重新应用，用 `python scripts/trophy-order.py <master.mdb>` 可从数据库重新提取。该字段修正泥地 G1 倒序、升格赛事及葵锦标的位置，收藏 ID 不变。

育成目标采用每条路线对应的 BWIKI 角色页面。解析保留最后一项目标，忽略隐藏空白行；粉丝数、累计胜绩与固定比赛分别处理。以下情况额外校对：

- [醒目飞鹰](https://gametora.com/ja/umamusume/characters/104601-smart-falcon)：补全资料站空标题的 Pre-OP 累计两胜目标。
- [大和赤骥](https://gamerch.com/umamusume/231593)：奥克斯／全国德比分支。
- [富士奇石、爱丽速子、待兼福来等目标分支](https://wikiwiki.jp/sppenpen/目標一覧)：联动路线、干劲分支及随机目标的日期。
- [美妙姿势](https://kamigame.jp/umamusume/page/207286010554354470.html)：最终目标四选一。
- [樱花千代王](https://kamigame.jp/umamusume/page/208012462212009556.html)：高级年东京英里赛／宝冢纪念分支。
- [目白雅丹](https://altema.jp/umamusume/chara/69/mokuhyou4)：经典年菊花奖／天王奖（秋）分支。
- [喜嘉奇迹](https://gametora.com/ja/umamusume/characters/ksmiracle)：经典年 9 月后半强制休息及高级年短途者锦标赛。
- [待兼唐怀瑟](https://wikiwiki.jp/vip_umamusu/マチカネタンホイザ【ぱんぱかティルトット】)：高级年全国杯剧情取消出赛，该回合不贡献奖杯。

剧本规则参考 [巅峰杯官方说明](https://umamusume.jp/contents/game/scenario/climax)、[凯旋门计划官方说明](https://umamusume.jp/contents/game/scenario/projectlarc/)，及 [凯旋门目标表](https://gamewith.jp/uma-musume/article/show/409161)、[青春杯赛程](https://gamewith.jp/uma-musume/article/show/287164)、[闪耀舞台演出时间](https://umamusumeschool.com/grandlive_memo/)、[荣耀女神杯年末赛说明](https://game.watch.impress.co.jp/docs/kikaku/1478459.html)。巅峰杯年末检查成绩点数；凯旋门检查支持者点数，不应混同普通粉丝数。

目标分支由使用者按照实际游戏事件选择。普通预约不会覆盖固定目标；更改目标分支时，仅移除因此发生冲突的普通预约并显示提示。参赛粉丝数只展示门槛，不模拟育成过程、继承、比赛输赢或随机事件。本工具的建议为日期与适性约束下的启发式排程，不保证单次育成取得所有目标或得到最大收益。
