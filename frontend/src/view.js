// 화면 템플릿 — 값은 전부 app.js renderVals()가 만들어 v로 전달
import { html } from './html.js';
import { DateRange } from './daterange.js';

export function view(v) {
  const {
    confirmIvKo, confirmSumKo, confirmSteps, onGoBandIv,
    activeCount, revPending, onKeepAllRevived, bandIvHint, bandLegend, bandNorm, bandNormLabel, bandNormNote, bandNormReady, onBandNorm, aliasRows, aliasCountText, aliasEmpty, aliasMoreText, onAliasScroll, tagQuery, onTagQuery, blEmpty, blK, blRows, blWin, blOldCnt, capShow, capText, capHint, capRows, cardSize, cards, cardDrag, cepNote, csvRange, delRepOpen, delRepName, delRepDate, onDelRepCancel, onDelRepDo, detBearing, detSpec, detWarn, detStale, detBusy, detBusyText, anchorNote, detailEmptyShow, detailShow, dlFmt, dlOpen, dxActions, dxAiFallback, dxAiIdle, dxAiLoading, dxAiSections, dxAiText, dxEvidence, dxLlmModel, dxOpen, dxStamp, dxToggleLabel, dxVerdict, envHint, envMarkers, equipRows, equipFilters, equipFilterEmpty, onEquipFilterAll, equipUnsetDot, evalBasisText, evalWinBad, evalWindowSel, evalWinCustom, evalWinCustomMin, onEvalWinMin, evalLoadText, evalLoadWarn, evalWindow, evalWindowOptions, evtCapped, evtCount, evtEmpty, evtEmptyText, evtRows, evtScopeChips, evtTagFilter, evtTagOptions, evtTypeFilter, evtTypeOptions, fftMarkers, fftRangeChips, fftRangeShow, filterNotice, tblFilterShow, tblOpen, tblOptions, tblChips, tblSelCount, tblTotal, tblAllOn, tblCaption, tblTip, tblNoneShow, tblQuery, tblNoMatch, tblMore, onTblQuery, onTblOpen, onTblClose, onTblMore, onTblSelectAll, onTblClearAll, genBtnLabel, genBtnStyle, genCancelLabel, genCancelStyle, genKnobStyle, genLLMNotice, genPeriodCustomShow, genPeriodNone, genPeriodNote, genPeriodPresets, genPeriodShow, genRange, genRunning, genSelAllLabel, genSteps, genTagsCount, genNoDataShow, genNoDataText, genToggleStyle, goSettings, gridCols, indicsDesc, indicsTitle, isMonitor, isOllama, isSettings, kpiCells, kurtWarn, kurtWarnShow, kurtNote, bandNote, kurtogramHint, kurtogramShow, lastEventText, lineHz, lineHzHint, lineHzShow, helpTip, healthWarns, bandOn, bandNoTargetWarn, bandInterval, bandFillNone, bandIntervalKo, onBandIvOpen, bandFill, bandFillDesc, bandFillShort, bandFillBtnStyle, bandFillBarStyle, bandFillEta, onBandFill, onBandFillStop, bandIvOpen, bandIvNext, bandIvSame, onBandIvCancel, onBandIvPick, bandIvFacts, bandIvChoices, bandIvApplyStyle, onBandIvApply, bandToggleStyle, bandKnobStyle, bandRows, bandEmpty, bandLearnedN, bandTotalN, bandFillTargets, bandFillSkipTip, bandIvOptions, onBandIvPickDirect, bandSampleText, bandSampleWarn, bandWin, bandWinOptions, onBandWin, blSampleText, llmApiKey, llmModel, llmModelPh, llmProvOptions, llmProviderSel, llmProviders, llmProvsAvail, llmStatusColor, llmStatusText, llmTestColor, llmTestIcon, llmTestMsg, llmTestShow, llmTesting, logoFilter, mcDescBody, mcDescTitle, mcOptions, mcZones, monBlNotice, monBlUnlearned, monEmpty, monEventsShow, monKnobStyle, monModeBadgeShow, monModeBadgeStyle, monModeBadgeText, monModeOptions, monPillTitle, monToggleStyle, monitorDotColor, monitorDotRing, monitorInterval, monitorText, navTabs, notReady, notifChannels, ollamaUrl, onBlK, onBlLearnAll, onBlWin, onCancelGen, onCardSize, onClearFilter, onCloseDownload, onConfirmCancel, onConfirmDiscard, onConfirmSave, onDlFmt, onDoDownload, onDxExplain, onEvalAgg, onEvalWindow, onEvtTag, onEvtType, onFormChange, onGenReport, onGenSelectAll, onGoSource, onBandToggle, onBandInterval, onBandLearnAll, onLineHz, onLlmKey, onLlmModel, onLlmProvPick, onMonToggle, onMonitorInterval, onOllamaUrl, onOpenDownload, onRefresh, onResetThresh, onRpNext, onRpPrev, onSaveSettings, onSrcDismiss, onSrcReload, onSrcSelectAll, onTagChange, onTestLLM, onToggleDx, onToggleGenLLM, onToggleMonitor, onTotalClick, pendingNavOpen, periodPresets, periodRange, qualityShow, qualityText, qualityNote, rpmWarn, rpmWarnAct, onRpmWarnAct, renotifyOptions, alertRows, reportEmpty, reportEmptyShow, reportRows, reportShow, reportTags, rootClass, routeNoneWarn, routeTimings, rpBtnStyle, rpPageText, rpPagerShow, secCriteria, secData, secEquip, secLlm, secMonitor, secSource, selTag,
    usageBusy, usageReady, onUsageRefresh, dataRows, dataFootnote, onGoCriteria,
    idSwitchShow, idSwitchTo, idSwitchFrom, idSwitchMon, onIdReload,
    orphanOpen, orphanRows, orphanTotalText, orphanBusy, onOrphanClose, onOrphanAll,
    purgePickShow, purgePickTitle, purgeRange, purgeHaveText, purgePickReady, onPurgePickCancel, onPurgePickNext,
    purgeShow, purgeTitle, purgeSub, purgeWhen, purgeCounting, purgeN, purgeKeep, purgeNone,
    userName, userAuthMsg, needsDb, dbExists, dbReady, dbAdmin, dbName, dbGrantSql, grantUsers, grantPick, grantBusy, grantMsg, onGrantOpen, onGrantPick, onGrantRun, dbWhy, dbBusy, onMakeDb, onCheckDb, appDbName, purgeAsk, purgeBullets, purgeTable, purgeTyped, purgeTypeOk, onPurgeType, purgeReady, purgeBtnLabel, purgeRunning, onPurgeCancel, onPurgeConfirm, serverMon, setNav, settingsActiveStyle, settingsDirty, sevCards, sevColor, sevGradeKo, sevHold, sevHoldDetail, sevHoldNote, sevHoldWhy, sevLabel, sevMachine, sevReco, sevZones,showAdvanced, specIndics, srcNotice, srcSelAllLabel, srcSelCount, srcTables, srcTotal, statSummary, statRows, stopClick, sumTotal, tagOptions, themeIcon, threshRows, toast, toastIcon, toastMsg, toastStyle, toggleTheme, totalStyle, unitChips, unitOptions,
    cfgFailShow, cfgFailTitle, cfgFailText, cfgFailWhy, cfgRepairShow, cfgRepairLabel, onCfgRetry, onCfgRepair, monEmptyFresh, monEmptyFail,
    tzValue, tzOptions, tzNow, onTzChange,
  } = v;
  return html`
<div class=${rootClass} style="height: 100vh; display: flex; flex-direction: column; background: var(--bg-primary); color: var(--text-primary); font-family: var(--font-sans); font-size: 13px; overflow: hidden;">

  <header style="display: flex; align-items: center; gap: 14px; height: 52px; padding: 0 16px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-default); flex-shrink: 0; position: relative; z-index: 20;">
    <div style="display: flex; align-items: center; gap: 12px;">
      <img src="assets/logo_machbaseNeo_general_a.png" alt="MACHBASE NEO" style="height: 21px; display: block; ${logoFilter}" />
      <span style="width: 1px; height: 20px; background: var(--border-default);"></span>
      <span style="display: inline-flex; align-items: center; gap: 8px; white-space: nowrap;">
        <span class="codicon codicon-pulse" style="font-size: 15px; color: var(--primary-light);"></span>
        <span style="font-size: 14px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.2px;">Vibration Analysis</span>
      </span>
    </div>
    <nav style="display: flex; gap: 2px; margin-left: 6px;">
      ${(navTabs || []).map((t) => html`
        <button onClick=${t.onClick} style=${t.style}><span class="codicon codicon-${t.icon}" style="font-size: 15px;"></span>${t.label}</button>
      `)}
    </nav>
    <div style="margin-left: auto; display: flex; align-items: center; gap: 9px;">
      <button onClick=${onToggleMonitor} title=${monPillTitle} style="display: flex; align-items: center; gap: 7px; padding: 5px 11px; background: var(--bg-elevated); border: 1px solid var(--border-default); border-radius: 6px; font-size: 12px; color: var(--text-secondary); cursor: pointer;">
        <span style="width: 8px; height: 8px; border-radius: 50%; background: ${monitorDotColor}; box-shadow: 0 0 0 3px ${monitorDotRing};"></span>알람 ${monitorText}${(monModeBadgeShow) ? html`<span style=${monModeBadgeStyle}>${monModeBadgeText}</span>` : null}
      </button>
      <button onClick=${goSettings} title="설정" style="position: relative; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 6px; border: 1px solid var(--border-default); background: var(--bg-elevated); color: var(--text-secondary); cursor: pointer; ${settingsActiveStyle}"><span class="codicon codicon-gear" style="font-size: 16px;"></span>${(equipUnsetDot) ? html`<span title="설정이 필요한 항목 있음 (설비 정보 미설정 또는 베이스라인 미학습)" style="position: absolute; top: 4px; right: 4px; width: 7px; height: 7px; border-radius: 50%; background: #d99a2b;"></span>` : null}</button>
      <button onClick=${toggleTheme} title="테마 전환" style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 6px; border: 1px solid var(--border-default); background: var(--bg-elevated); color: var(--text-secondary); cursor: pointer;"><span class="codicon codicon-${themeIcon}" style="font-size: 16px;"></span></button>
    </div>
  </header>

  <main style="flex: 1; min-height: 0; overflow: auto;">

    ${(notReady) ? html`
      <div style="max-width: 1360px; margin: 0 auto; padding: 20px;">
        <div style="display: flex; gap: 12px; margin-bottom: 16px;">
          <div style="flex: 1; height: 74px; background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; animation: vskl 1.3s ease-in-out infinite;"></div>
          <div style="flex: 1; height: 74px; background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; animation: vskl 1.3s ease-in-out infinite .2s;"></div>
          <div style="flex: 1; height: 74px; background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; animation: vskl 1.3s ease-in-out infinite .4s;"></div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px;">
          <div style="height: 150px; background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; animation: vskl 1.3s ease-in-out infinite;"></div>
          <div style="height: 150px; background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; animation: vskl 1.3s ease-in-out infinite .15s;"></div>
          <div style="height: 150px; background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; animation: vskl 1.3s ease-in-out infinite .3s;"></div>
          <div style="height: 150px; background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; animation: vskl 1.3s ease-in-out infinite .45s;"></div>
        </div>
        <div style="text-align: center; margin-top: 22px; color: var(--text-muted); font-size: 12px;">진동 데이터 로딩 중…</div>
      </div>
    ` : null}

    ${(cfgFailShow) ? html`
      <div style="max-width: 640px; margin: 56px auto; padding: 0 20px;">
        <div style="display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px 24px; background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 10px; text-align: center;">
          <span class="codicon codicon-warning" style="font-size: 32px; color: #e07b39;"></span>
          <div style="font-size: 15px; font-weight: 600; color: var(--text-secondary);">${cfgFailTitle}</div>
          <div style="font-size: 12px; color: var(--text-muted); max-width: 480px; line-height: 1.6;">${cfgFailText}</div>
          <div style="font-size: 11px; color: var(--text-muted); max-width: 480px; word-break: break-all;">${cfgFailWhy}</div>
          <div style="display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; justify-content: center;">
            <button onClick=${onCfgRetry} style="height: 34px; padding: 0 16px; border-radius: 6px; border: none; background: var(--primary-base); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;">다시 시도</button>
            ${(cfgRepairShow) ? html`<button onClick=${onCfgRepair} style="height: 34px; padding: 0 16px; border-radius: 6px; border: 1px solid var(--border-default); background: var(--bg-elevated); color: var(--text-secondary); font-size: 13px; font-weight: 600; cursor: pointer;">${cfgRepairLabel}</button>` : null}
          </div>
        </div>
      </div>
    ` : null}

    ${(isMonitor) ? html`
      <div data-screen-label="모니터링" style="max-width: 1360px; margin: 0 auto; padding: 18px 20px 40px;">
        ${(healthWarns || []).map((w) => html`
          <div style=${w.style}>
            <span class="codicon codicon-${w.err ? 'error' : 'warning'}" style=${w.iconStyle}></span>
            <span style="font-size: 13px; color: var(--text-secondary);">${w.text}</span>
            ${(w.act) ? html`<button onClick=${w.onAct} style="margin-left: auto; height: 30px; padding: 0 14px; border-radius: 6px; border: none; background: var(--primary-base); color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; flex-shrink: 0;">${w.act}</button>` : null}
          </div>
        `)}
        ${(srcNotice) ? html`
          <div style="display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-radius: 8px; background: rgba(217,154,43,0.12); border: 1px solid rgba(217,154,43,0.35); margin-bottom: 16px;">
            <span class="codicon codicon-warning" style="font-size: 16px; color: #d99a2b; flex-shrink: 0;"></span>
            <span style="font-size: 13px; color: var(--text-secondary);">${srcNotice}</span>
            <button onClick=${onSrcReload} style="margin-left: auto; height: 30px; padding: 0 14px; border-radius: 6px; border: none; background: var(--primary-base); color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; flex-shrink: 0;">다시 불러오기</button>
            <button onClick=${onSrcDismiss} style="height: 30px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-default); background: transparent; color: var(--text-secondary); font-size: 12px; cursor: pointer; flex-shrink: 0;">무시</button>
          </div>
        ` : null}
        <div style="display: flex; flex-wrap: wrap; background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; overflow: hidden; margin-bottom: 16px;">
          <button onClick=${onTotalClick} style=${totalStyle} class="vhov1">
            <div style="font-size: 10px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; color: var(--text-muted);">총 설비</div>
            <div style="margin-top: 6px; font-size: 26px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; line-height: 1;">${sumTotal}</div>
          </button>
          ${(kpiCells || []).map((k) => html`
            <button onClick=${k.onClick} style=${k.style} class="vhov1">
              <div data-tip=${k.tip || null} style="display: flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; color: var(--text-muted);${k.tip ? ' cursor: help;' : ''}">${k.label}${(k.active) ? html`<span class="codicon codicon-filter" style="font-size: 10px; color: var(--primary-light);"></span>` : null}</div>
              <div style="margin-top: 6px; font-size: 26px; font-weight: 700; color: ${k.color}; font-variant-numeric: tabular-nums; line-height: 1;">${k.count}</div>
            </button>
          `)}
          <div style="flex: 1.6 1 0; min-width: 180px; padding: 14px 18px;">
            <div style="font-size: 10px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; color: var(--text-muted);">최근 이벤트</div>
            <div style="margin-top: 9px; font-size: 15px; font-weight: 600; color: var(--text-secondary); font-family: var(--font-mono);">${lastEventText}</div>
          </div>
        </div>

        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 12px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary);"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>설비 모니터링<span style="display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 500; color: #3aa76d; margin-left: 4px;"><span style="width: 7px; height: 7px; border-radius: 50%; background: #3aa76d; animation: vpulse 1.6s ease-in-out infinite;"></span>실시간</span><span style="display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; padding: 3px 10px; border-radius: 6px; background: var(--bg-secondary); border: 1px solid var(--border-default); font-size: 12px; font-weight: 500; color: var(--text-secondary); font-family: var(--font-mono);"><span class="codicon codicon-history" style="font-size: 12px; color: var(--text-muted);"></span><span id="vclock">—</span></span>
            ${(tblFilterShow) ? html`
              <div style="position: relative; display: inline-flex; align-items: center; gap: 6px; margin-left: 4px;">
                <button onClick=${onTblOpen} data-tip=${tblTip} style="display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 9px; border-radius: 6px; border: 1px solid ${(tblSelCount) ? 'rgba(0,108,210,.45)' : 'var(--border-medium)'}; background: var(--bg-elevated); color: var(--text-secondary); font-size: 12px; font-weight: 500; font-family: inherit; cursor: pointer;"><span class="codicon codicon-filter" style="font-size: 12px; color: var(--text-muted);"></span>테이블 필터<span style="height: 16px; padding: 0 5px; border-radius: 8px; background: ${(tblAllOn) ? 'var(--bg-primary)' : 'var(--primary-base)'}; color: ${(tblAllOn) ? 'var(--text-muted)' : '#fff'}; font-size: 10px; font-weight: 700; font-family: var(--font-mono); display: inline-flex; align-items: center;">${(tblAllOn) ? '전체' : tblSelCount + '/' + tblTotal}</span><span class="codicon codicon-chevron-down" style="font-size: 11px; color: var(--text-muted);"></span></button>
                ${(tblCaption) ? html`<span style="font-size: 11px; font-weight: 500; color: var(--text-muted);">${tblCaption}</span>` : null}
                ${(tblChips || []).map((c) => html`
                  <span style="display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 5px; border: 1px solid rgba(0,108,210,.35); background: rgba(0,108,210,.10); color: var(--primary-light); font-size: 11px; font-weight: 600; font-family: var(--font-mono);">${c.name}<span style="opacity: .6; font-weight: 500;">${c.count}</span><span onClick=${c.onRemove} class="codicon codicon-close" style="font-size: 11px; cursor: pointer; opacity: .8;"></span></span>
                `)}
                ${(tblMore > 0) ? html`<button onClick=${onTblMore} title="접힌 테이블 보기" style="height: 24px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-secondary); font-size: 11px; font-weight: 600; font-family: var(--font-mono); cursor: pointer;">+${tblMore}</button>` : null}
                ${(tblOpen) ? html`
                  <div style="position: absolute; top: 32px; left: 0; z-index: 40; width: 272px; padding: 6px; border-radius: 8px; border: 1px solid var(--border-medium); background: var(--bg-elevated); box-shadow: 0 10px 28px rgba(0,0,0,.35);">
                    <input type="text" value=${tblQuery} onInput=${onTblQuery} placeholder="테이블 검색" style="width: 100%; height: 30px; margin-bottom: 4px; padding: 0 9px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-primary); color: var(--text-primary); font-size: 12px; font-family: inherit; box-sizing: border-box;" />
                    <div style="max-height: 240px; overflow-y: auto;">
                      ${(tblOptions || []).map((o) => html`
                        <label style="display: flex; align-items: center; gap: 9px; padding: 7px 9px; border-radius: 5px; cursor: pointer; font-size: 12px; font-weight: 500; color: var(--text-primary);" class="vhov3">
                          <input type="checkbox" checked=${o.checked} onChange=${o.onToggle} style="width: 14px; height: 14px; accent-color: var(--primary-base); cursor: pointer;" />
                          <span style="font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${o.name}</span>
                          <span style="margin-left: auto; font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${o.count}</span>
                        </label>
                      `)}
                      ${(tblNoMatch) ? html`<div style="padding: 12px 9px; font-size: 11px; color: var(--text-muted);">일치하는 테이블이 없습니다</div>` : null}
                    </div>
                    <div style="display: flex; align-items: center; gap: 14px; margin-top: 4px; padding: 8px 9px 3px; border-top: 1px solid var(--border-light);">
                      <button onClick=${onTblSelectAll} style="background: transparent; border: none; color: var(--text-muted); font-size: 11px; font-weight: 500; font-family: inherit; cursor: pointer; padding: 0;">전체 선택</button>
                      <button onClick=${onTblClearAll} style="background: transparent; border: none; color: var(--text-muted); font-size: 11px; font-weight: 500; font-family: inherit; cursor: pointer; padding: 0;">전체 해제</button>
                      <button onClick=${onTblClose} style="margin-left: auto; background: transparent; border: none; color: var(--primary-light); font-size: 11px; font-weight: 700; font-family: inherit; cursor: pointer; padding: 0;">닫기</button>
                    </div>
                  </div>
                ` : null}
              </div>
            ` : null}</div>
          <div style="display: flex; align-items: center; gap: 16px;">
            <div style="display: flex; align-items: center; gap: 8px;"><span style="font-size: 11px; color: var(--text-muted);">카드 크기</span><input type="range" min="200" max="600" step="8" value=${cardSize} onChange=${onCardSize} style="width: 120px; accent-color: var(--primary-base); cursor: pointer;" /></div>
            ${(filterNotice) ? html`<button onClick=${onClearFilter} style="display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 5px; border: 1px solid var(--primary-light); background: rgba(0,108,210,.10); color: var(--primary-light); font-size: 11px; font-weight: 600; cursor: pointer;">${filterNotice}<span class="codicon codicon-close" style="font-size: 11px;"></span></button>` : null}<span style="font-size: 11px; color: var(--text-muted);">값: ${evalBasisText} · 등급: 결함 패턴 + ISO 존 · 위험 등급순 · 클릭 시 상세분석</span>
          </div>
        </div>

        ${(monEmpty) ? html`
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 64px 20px; background: var(--bg-secondary); border: 1px dashed var(--border-default); border-radius: 10px; text-align: center;">
            <span class="codicon codicon-inbox" style="font-size: 36px; color: var(--text-muted);"></span>
            <div style="font-size: 15px; font-weight: 600; color: var(--text-secondary);">${monEmptyFail ? '데이터를 불러오지 못했습니다' : monEmptyFresh ? '저장된 설정이 없습니다' : '표시할 설비가 없습니다'}</div>
            <div style="font-size: 12px; color: var(--text-muted); max-width: 380px; line-height: 1.6;">${monEmptyFail
              ? '선택한 테이블을 조회하지 못해 표시할 설비가 없습니다. 선택은 그대로 남아 있고, 위 안내대로 자동으로 다시 시도합니다.'
              : monEmptyFresh
              ? '아직 이 계정으로 저장한 설정이 없습니다. 데이터 소스에서 감시할 TAG table을 고르는 것부터 시작하세요.'
              : '선택된 데이터 소스가 없습니다. 설정 → 데이터 소스에서 TAG table을 선택하면 해당 태그가 여기에 표시됩니다.'}</div>
            <button onClick=${onGoSource} style="margin-top: 4px; height: 34px; padding: 0 16px; border-radius: 6px; border: none; background: var(--primary-base); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;">${monEmptyFresh ? '설정 시작' : '데이터 소스 설정'}</button>
          </div>
        ` : null}
        ${/* 테이블 필터로 전부 숨긴 빈 상태(위 빈 상태는 소스 문제 전용) */ ''}
        ${(tblNoneShow) ? html`
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 48px 20px; background: var(--bg-secondary); border: 1px dashed var(--border-default); border-radius: 10px; text-align: center;">
            <span class="codicon codicon-filter" style="font-size: 28px; color: var(--text-muted);"></span>
            <div style="font-size: 14px; font-weight: 600; color: var(--text-secondary);">표시할 테이블을 하나도 고르지 않았습니다</div>
            <div style="font-size: 12px; color: var(--text-muted);">감시는 그대로 돌고 있습니다 — 테이블 필터에서 다시 고르면 카드가 나옵니다.</div>
            <button onClick=${onTblSelectAll} style="margin-top: 4px; height: 30px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-secondary); font-size: 12px; font-weight: 600; font-family: inherit; cursor: pointer;">전체 표시</button>
          </div>
        ` : null}
        <div style="display: grid; grid-template-columns: ${gridCols}; gap: 12px;">
          ${(cards || []).map((card) => html`
            <button onClick=${card.onClick} draggable="true" onDragStart=${cardDrag && cardDrag.onStart(card.id)} onDragOver=${cardDrag && cardDrag.onOver(card.id)} onDrop=${cardDrag && cardDrag.onDrop()} onDragEnd=${cardDrag && cardDrag.onEnd} style="${(cardDrag && cardDrag.dragId === card.id) ? 'opacity: .35;' : ''} text-align: left; background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 14px 15px 12px; cursor: ${cardDrag && cardDrag.dragId ? 'grabbing' : 'grab'}; transition: border-color .15s ease, transform .12s ease; ${card.cardStyle}" class="vhov2">
              <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
                <div style="min-width: 0;">
                  <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${card.alias}</div>
                  <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">${card.sub}</div>
                </div>
                ${(card.flap) ? html`<span data-tip=${card.flap.tip} onClick=${card.flap.onOpen} style="flex-shrink: 0; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 700; cursor: pointer; color: #d99a2b; background: rgba(217,154,43,.14); border: 1px solid rgba(217,154,43,.35);">${card.flap.text}</span>` : null}
                ${(card.hold) ? html`<span data-tip=${card.holdTip} style="flex-shrink: 0; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: help; color: var(--text-muted); background: var(--bg-elevated); border: 1px solid var(--border-default);">판정 보류</span>` : html`<span style="flex-shrink: 0; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; color: ${card.gradeColor}; background: ${card.gradeSoft};">${card.gradeKo}${(card.gradeNote) ? html`<span style="opacity: .75; font-weight: 600;"> · ${card.gradeNote}</span>` : null}</span>`}
              </div>
              <div style="display: flex; align-items: flex-end; gap: 4px; margin-top: 12px;">
                <span data-tip=${card.valTip || null} style="font-size: 28px; font-weight: 700; color: var(--text-primary); line-height: 1; font-variant-numeric: tabular-nums; ${card.valTip ? 'cursor: help;' : ''}">${card.rmsText}</span>
                <span style="font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 2px;">${card.unit}</span>
                <span data-tip=${card.valTip || null} style="margin-left: auto; font-size: 10px; color: var(--text-muted); margin-bottom: 3px;${card.valTip ? ' cursor: help;' : ''}">${card.mainUnit}</span>
              </div>
              <!-- 운전 상태 배지는 스파크라인 위에 겹침 · 두절·계측 이상이면 선도 흐리게 -->
              <div style="position: relative; margin-top: 8px;">
                <svg viewBox="0 0 132 40" preserveAspectRatio="none" style="width: 100%; height: ${card.sparkH}px; display: block; opacity: ${(card.runBadge && card.runBadge.err) ? '.4' : '1'};">
                  <path d=${card.sparkArea} fill=${card.sparkFill} stroke="none"></path>
                  <polyline points=${card.sparkLine} fill="none" stroke=${card.sparkColor} stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>
                </svg>
                ${(card.runBadge) ? html`<span data-tip=${card.runBadge.tip} style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 9px; border-radius: 5px; font-size: 11px; font-weight: 600; white-space: nowrap; cursor: help; background: var(--bg-secondary); color: ${card.runBadge.err ? '#e04040' : 'var(--text-muted)'}; border: 1px solid ${card.runBadge.err ? 'rgba(224,64,64,.55)' : 'var(--border-medium)'};"><span class="codicon codicon-${card.runBadge.text === '계측 이상' ? 'warning' : card.runBadge.err ? 'debug-disconnect' : 'debug-pause'}" style="font-size: 11px;"></span>${card.runBadge.text}</span>` : null}
              </div>
              <!-- 두절·계측 이상이면 캡션 비움(높이 유지) — 멈춘 값의 "실시간" 표기 방지 -->
              <div style="text-align: right; font-size: 10px; color: var(--text-muted); margin-top: 3px; min-height: 1.3em;">${(card.runBadge && card.runBadge.err) ? '' : '실시간 · 최근 1분'}</div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--border-light); font-size: 11px; color: var(--text-muted);">
                <span><span class="codicon codicon-history" style="font-size: 11px; vertical-align: -1px; margin-right: 3px;"></span>${card.lastText}</span>
                <span style="color: var(--text-tertiary);">Class ${card.cls}</span>
              </div>
            </button>
          `)}
        </div>
      </div>
    ` : null}

    ${(detailEmptyShow) ? html`
      <div style="max-width: 1360px; margin: 0 auto; padding: 18px 20px 40px;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; min-height: 440px; background: var(--bg-secondary); border: 1px dashed var(--border-default); border-radius: 10px; text-align: center; padding: 40px 24px;">
          <span class="codicon codicon-database" style="font-size: 34px; color: var(--text-muted);"></span>
          <div style="font-size: 16px; font-weight: 600; color: var(--text-primary);">분석할 데이터가 없습니다</div>
          <div style="font-size: 13px; color: var(--text-muted); max-width: 400px; line-height: 1.6;">설정 › 데이터 소스에서 분석할 TAG table을 선택하면 여기에 상세 분석이 표시됩니다.</div>
          <button onClick=${onGoSource} style="display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 16px; border-radius: 6px; border: none; background: var(--primary-base); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;"><span class="codicon codicon-arrow-right" style="font-size: 14px;"></span>데이터 소스 설정</button>
        </div>
      </div>
    ` : null}

    ${(detailShow) ? html`
      <div data-screen-label="상세분석" style="max-width: 1360px; margin: 0 auto; padding: 18px 20px 40px;">
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px;">
          <select value=${selTag} onChange=${onTagChange} style="height: 34px; min-width: 260px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px; font-weight: 500; cursor: pointer;">
            ${(tagOptions || []).map((o) => html`<option value=${o.id}>${o.label}</option>`)}
          </select>
          <div style="display: flex; background: var(--bg-elevated); border: 1px solid var(--border-default); border-radius: 6px; overflow: hidden;">
            ${(periodPresets || []).map((p) => html`<button onClick=${p.onClick} title=${p.title} style=${p.style}>${p.label}</button>`)}
          </div>
          <${DateRange} ...${periodRange} />
          <button onClick=${onRefresh} style="margin-left: auto; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--border-default); background: var(--bg-elevated); color: var(--text-secondary); font-size: 12px; font-weight: 500; cursor: pointer;"><span class="codicon codicon-refresh" style="font-size: 14px;"></span>새로고침</button>
        </div>

        ${(detBusy) ? html`
          <div style="display: flex; align-items: center; gap: 10px; padding: 12px 14px; margin-bottom: 14px; border-radius: 8px; background: var(--overlay-hover); border: 1px solid var(--border-default);">
            <span class="codicon codicon-loading" style="font-size: 14px; color: var(--primary-light); animation: vspin 1s linear infinite;"></span>
            <div style="font-size: 12.5px; color: var(--text-secondary); line-height: 1.6;">${detBusyText}</div>
          </div>
        ` : null}

        ${(detWarn) ? html`
          <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; margin-bottom: 14px; border-radius: 8px; background: rgba(199,125,10,.1); border: 1px solid rgba(199,125,10,.4);">
            <span class="codicon codicon-warning" style="font-size: 14px; color: var(--warning); margin-top: 1px;"></span>
            <div style="font-size: 12.5px; color: var(--text-secondary); line-height: 1.6;">${detWarn}</div>
          </div>
        ` : null}

        ${(rpmWarn) ? html`
          <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; margin-bottom: 14px; border-radius: 8px; background: rgba(199,125,10,.1); border: 1px solid rgba(199,125,10,.4);">
            <span class="codicon codicon-dashboard" style="font-size: 14px; color: var(--warning); margin-top: 1px;"></span>
            <div style="flex: 1; font-size: 12.5px; color: var(--text-secondary); line-height: 1.6;">${rpmWarn}</div>
            <button onClick=${onRpmWarnAct} style="flex-shrink: 0; height: 26px; padding: 0 12px; border-radius: 5px; border: 1px solid #d99a2b; background: transparent; color: #d99a2b; font-size: 11px; font-weight: 600; cursor: pointer;">${rpmWarnAct}</button>
          </div>
        ` : null}

        ${(detStale) ? html`
          <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; margin-bottom: 14px; border-radius: 8px; background: rgba(0,108,210,.10); border: 1px solid var(--primary-light);">
            <span class="codicon codicon-history" style="font-size: 14px; color: var(--primary-light); margin-top: 1px;"></span>
            <div style="flex: 1; font-size: 12.5px; color: var(--text-secondary); line-height: 1.6;">${detStale}</div>
            <button onClick=${onRefresh} style="flex-shrink: 0; height: 26px; padding: 0 12px; border-radius: 5px; border: 1px solid var(--primary-light); background: transparent; color: var(--primary-light); font-size: 11px; font-weight: 600; cursor: pointer;">새로고침</button>
          </div>
        ` : null}

        ${(qualityShow) ? html`
          <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; margin-bottom: 14px; border-radius: 8px; background: rgba(199,125,10,.1); border: 1px solid rgba(199,125,10,.4);">
            <span class="codicon codicon-warning" style="font-size: 16px; color: var(--warning); margin-top: 1px; flex-shrink: 0;"></span>
            <div style="font-size: 12px; line-height: 1.55;"><b style="color: var(--warning);">신호 이상 — 센서 점검 필요</b><div style="color: var(--text-secondary); margin-top: 3px;">${qualityText}</div><div style="color: var(--text-muted); margin-top: 3px;">아래 분석·판정 결과를 신뢰하기 전에 센서·케이블 연결을 확인하세요.</div></div>
          </div>
        ` : null}
        ${(qualityNote) ? html`
          <div style="display: flex; align-items: flex-start; gap: 8px; margin: -4px 2px 12px; font-size: 11.5px; line-height: 1.5; color: var(--text-muted);">
            <span class="codicon codicon-info" style="font-size: 13px; margin-top: 1px; flex-shrink: 0;"></span><span>${qualityNote}</span>
          </div>
        ` : null}
        <div style="display: flex; flex-wrap: wrap; background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; overflow: hidden; margin-bottom: 14px;">
          ${(detSpec || []).map((s) => html`
            <div style="flex: 1 1 0; min-width: 160px; padding: 14px 18px; border-right: 1px solid var(--border-default);">
              <div style="font-size: 10px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; color: var(--text-muted);">${s.k}</div>
              <div style="margin-top: 8px; font-size: 15px; font-weight: 600; color: var(--text-primary); font-family: var(--font-mono);">${s.v}</div>
            </div>
          `)}
        </div>

        <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 18px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
            <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary);"><span style="width: 3px; height: 15px; border-radius: 2px; background: ${sevColor};"></span>진동 심각도 평가</div>
            <div style="font-size: 12px; color: var(--text-muted); font-family: var(--font-mono);">${sevMachine}</div>
          </div>
          <div style="border: 1px solid var(--border-light); border-radius: 10px; padding: 18px 20px 12px; margin-bottom: 14px;">
            <div style="display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 14px;">
              <div style="min-width: 0;">
                <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 3px;">${sevLabel}</div>
                <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                  <span style="font-size: 38px; font-weight: 800; color: ${sevColor}; line-height: 1; letter-spacing: -0.5px;">${sevGradeKo}</span>
                  ${(sevHold) ? html`<span data-tip=${sevHoldDetail || null} style="padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #8a8f99; background: rgba(138,143,153,0.16); border: 1px solid rgba(138,143,153,0.4); ${sevHoldDetail ? 'cursor: help;' : ''}">판정 보류</span>` : null}
                </div>
                <!-- 판정 동결 사유를 등급 바로 아래 표시 -->
                ${(sevHold) ? html`<div style="font-size: 12px; color: var(--text-secondary); margin-top: 7px;"><b style="color: #d99a2b;">${sevHoldWhy}</b> — ${sevHoldNote}</div>` : null}
              </div>
            </div>
            <div style="display: flex; height: 30px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border-light);">
              ${(sevZones || []).map((z) => html`<div style=${z.cellStyle}>${z.ko}</div>`)}
            </div>
            <div style="display: flex; margin-top: 4px;">
              ${(sevZones || []).map((z) => html`<div style=${z.labStyle}>${z.range}</div>`)}
            </div>
            <div style="display: flex; align-items: center; gap: 12px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-light); flex-wrap: wrap;">
              <div style="flex: 1 1 240px; min-width: 0; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;">
                <span style="font-size: 13px; font-weight: 600; color: var(--text-primary);">${dxVerdict}</span>
                <span style="font-size: 12px; color: var(--text-tertiary);">${sevReco}</span>
                ${anchorNote ? html`<span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${anchorNote}</span>` : null}
              </div>
              <button onClick=${onToggleDx} style="flex-shrink: 0; height: 28px; padding: 0 12px; border-radius: 5px; border: 1px solid var(--border-medium); background: transparent; color: var(--text-secondary); font-size: 11px; font-weight: 600; cursor: pointer;" class="vhov3">${dxToggleLabel}</button>
            </div>
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 7px;">기간 통계 — 선택한 기간 전체의 롤업 버킷에서 냅니다. 등급이 아닙니다(등급은 위 종합 판정)</div>
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
            ${(sevCards || []).map((c) => html`
              <div style="padding: 13px 14px; border: 1px solid var(--border-light); border-radius: 9px; ${c.style}">
                <div style="margin-bottom: 8px; font-size: 12px; font-weight: 500; color: var(--text-secondary);">${c.label}${c.badgeKo ? html`<span style="display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 700; letter-spacing: .3px; color: ${c.badgeColor}; background: ${c.badgeSoft}; border: 1px solid ${c.badgeBorder}; margin-left: 4px; vertical-align: middle;">${c.badgeKo}</span>` : null}</div>
                <div style="font-size: 26px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.5px; margin-bottom: 8px; font-variant-numeric: tabular-nums;">${c.valueText}<span style="font-size: 12px; font-weight: 500; color: var(--text-muted); margin-left: 2px;">${c.unit}</span></div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                  <span style="color: var(--text-muted);">${c.thrText}</span>
                  <span style="color: ${c.arrowColor}; font-weight: 600;">${c.arrow} ${c.deltaText}</span>
                </div>
                ${(c.foot2) ? html`<div style="margin-top: 6px; font-size: 10.5px; color: var(--text-muted); line-height: 1.45;">${c.foot2}</div>` : null}
              </div>
            `)}
          </div>
        </div>

        ${(dxOpen) ? html`
        <div id="dx-card" style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 18px; margin: -4px 0 14px;">
          <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 14px;"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>종합 분석 <span style="font-size: 12px; font-weight: 500; color: var(--text-muted); font-family: var(--font-mono);">${dxStamp}</span><button onClick=${onToggleDx} title="접기" style="margin-left: auto; width: 28px; height: 28px; border-radius: 5px; border: 1px solid var(--border-default); background: transparent; color: var(--text-muted); cursor: pointer;"><span class="codicon codicon-chevron-up" style="font-size: 14px;"></span></button></div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px;">
            <div>
              <div style="font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px;">판정 근거</div>
              <div style="display: flex; flex-direction: column; gap: 7px;">
                ${(dxEvidence || []).map((e) => html`
                  <div style="display: flex; align-items: flex-start; gap: 8px; font-size: 12px; line-height: 1.5;">
                    <span style="flex-shrink: 0; min-width: 58px; text-align: center; padding: 2px 7px; border-radius: 3px; font-size: 10px; font-weight: 700; color: var(--primary-light); background: rgba(0,108,210,.12); font-family: var(--font-mono);">${e.src}</span>
                    <span style="color: var(--text-secondary);">${e.txt}</span>
                  </div>
                `)}
              </div>
            </div>
            <div>
              <div style="font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px;">권고 조치</div>
              <div style="display: flex; flex-direction: column; gap: 7px;">
                ${(dxActions || []).map((a) => html`
                  <div style="display: flex; align-items: flex-start; gap: 8px; font-size: 12px; line-height: 1.5;"><span style="color: var(--primary-light); font-weight: 700; font-family: var(--font-mono);">${a.no}</span><span style="color: var(--text-secondary);">${a.txt}</span></div>
                `)}
              </div>
            </div>
          </div>
          <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border-light);">
            ${(dxAiIdle) ? html`<div style="display: flex; align-items: center; gap: 10px;"><button onClick=${onDxExplain} style="display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px; border-radius: 6px; border: none; background: var(--primary-base); color: #fff; font-size: 12px; font-weight: 600; cursor: pointer;"><span class="codicon codicon-sparkle" style="font-size: 14px;"></span>LLM 상세 소견 생성</button>${(llmProvsAvail) ? html`<select value=${llmProviderSel} onChange=${onLlmProvPick} style="height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; cursor: pointer;"><option value="">— 프로바이더 —</option>${(llmProvOptions || []).map((o) => html`<option value=${o.id}>${o.label}</option>`)}</select>` : null}</div>` : null}
            ${(dxAiLoading) ? html`<div style="font-size: 13px; color: var(--text-tertiary); display: flex; align-items: center; gap: 8px;"><span class="codicon codicon-loading" style="font-size: 14px;"></span>소견 생성 중…</div>` : null}
            ${(dxAiFallback) ? html`<div style="font-size: 12px; color: var(--text-tertiary); line-height: 1.6;">LLM이 설정되지 않았습니다. <b style="color: var(--text-secondary);">설정 › LLM 연동</b>에서 모델을 연결하면 데이터 기반 상세 소견을 생성합니다.</div>` : null}
            ${(dxAiText) ? html`${(dxAiSections || []).map((s) => html`${(s.heading) ? html`<div style="font-size: 13px; font-weight: 700; color: var(--text-primary); margin: 14px 0 5px;">${s.heading}</div>` : null}<div style="font-size: 13px; color: var(--text-secondary); line-height: 1.7; white-space: pre-wrap;">${s.body}</div>`)}${(dxLlmModel) ? html`<div style="margin-top: 10px; font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">생성: ${dxLlmModel}</div>` : null}` : null}
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 10px;">규칙 기반 자동 판정 + LLM 소견 · 참고용 — 단일 채널·단일 방향, 위상 정보 없음, 명판 회전속도 기준이라 결함 메커니즘은 가설입니다. 확정 진단에는 다축·위상 측정과 정비 담당자 확인이 필요합니다.</div>
          </div>
        </div>
        ` : null}

        <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 16px 18px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>통계 요약</div>
          ${(statSummary) ? html`<div title=${statSummary} style="font-size: 12px; color: var(--text-muted); margin: -4px 0 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${statSummary}</div>` : null}
          <!-- 한 칸 한 줄·스크롤 없음 — 폭 부족 시 넓은 칸부터 말줄임(전문은 hover) -->
          <div style="display: flex; flex-direction: column; gap: 1px; background: var(--border-light); border: 1px solid var(--border-light); border-radius: 6px; overflow: hidden;">
            ${[(statRows || []).filter((r) => r.wide), (statRows || []).filter((r) => !r.wide)].map((grp, gi) => (grp.length ? html`
              <div style="display: flex; gap: 1px;">
                ${grp.map((r) => html`
                  <div style="flex: 1 1 auto; min-width: 0; background: ${gi === 0 ? 'var(--bg-elevated)' : 'var(--bg-secondary)'}; padding: 13px 16px;">
                    <div title=${r.k} style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${r.k}</div>
                    <div title=${r.t || r.v} style="margin-top: 5px; font-size: 15px; font-weight: 600; line-height: 1.45; color: var(--text-primary); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${r.v}</div>
                  </div>
                `)}
              </div>
            ` : null))}
          </div>
        </div>

        <div id="sec-trend" style="display: flex; align-items: center; gap: 10px; margin: 6px 0 12px;">
          <span class="codicon codicon-graph-line" style="font-size: 14px; color: var(--primary-light);"></span>
          <span style="font-size: 13px; font-weight: 700; letter-spacing: .6px; color: var(--text-primary);">추세 분석</span>
          <span style="font-size: 11px; color: var(--text-muted);">시간에 따른 지표 변화 · 열화 진행 추적</span>
          <div style="flex: 1 1 0; height: 1px; background: var(--border-light);"></div>
        </div>

        <div style="background: var(--bg-primary); border: 1px solid var(--border-default); border-radius: 8px; padding: 16px 18px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>RMS 추이 <span style="font-weight: 500; color: var(--text-muted); font-size: 13px;">ISO 10816 존 기준선</span></div>
          <div style="font-size: 12px; color: var(--text-muted); margin: -4px 0 12px;">진동 에너지(실효값)의 시간 변화 · ISO 존 기준선 대비 심각도 추적</div>
          <div style="position: relative;">
            <canvas id="vc-rms" style="width: 100%; height: 230px; display: block;"></canvas>
            <div id="vt-rms" style="position: absolute; display: none; pointer-events: none; z-index: 10; background: var(--surface-menu); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: 4px; padding: 6px 9px; font-size: 12px; line-height: 1.55; white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,.3); font-family: var(--font-mono);"></div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(460px, 1fr)); gap: 14px; margin-bottom: 14px;">
          <div style="background: var(--bg-primary); border: 1px solid var(--border-default); border-radius: 8px; padding: 16px 18px;">
            <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>Peak-to-Peak 추이</div>
            <div style="font-size: 12px; color: var(--text-muted); margin: -4px 0 12px;">최대-최소 진폭의 폭 · 순간 충격·부딪힘의 크기</div>
            <div style="position: relative;">
              <canvas id="vc-p2p" style="width: 100%; height: 220px; display: block;"></canvas>
              <div id="vt-p2p" style="position: absolute; display: none; pointer-events: none; z-index: 10; background: var(--surface-menu); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: 4px; padding: 6px 9px; font-size: 12px; line-height: 1.55; white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,.3); font-family: var(--font-mono);"></div>
            </div>
          </div>
          <div style="background: var(--bg-primary); border: 1px solid var(--border-default); border-radius: 8px; padding: 16px 18px;">
            <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>Crest Factor 추이</div>
            <div style="font-size: 12px; color: var(--text-muted); margin: -4px 0 12px;">피크/RMS 비 · 파형의 뾰족함(충격성 결함 지표)</div>
            <div style="position: relative;">
              <canvas id="vc-crest" style="width: 100%; height: 220px; display: block;"></canvas>
              <div id="vt-crest" style="position: absolute; display: none; pointer-events: none; z-index: 10; background: var(--surface-menu); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: 4px; padding: 6px 9px; font-size: 12px; line-height: 1.55; white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,.3); font-family: var(--font-mono);"></div>
            </div>
          </div>
          ${(showAdvanced) ? html`
          <div style="background: var(--bg-primary); border: 1px solid var(--border-default); border-radius: 8px; padding: 16px 18px;">
            <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>첨도 추이 <span style="font-weight: 500; color: var(--text-muted); font-size: 13px;">Kurtosis</span></div>
            <div style="font-size: 12px; color: var(--text-muted); margin: -4px 0 12px;">파형 뾰족함의 통계 지표 · 3 = 정상(정규분포) · 클수록 충격성 결함</div>
            ${(kurtNote) ? html`<div style="font-size: 11.5px; color: var(--text-muted); padding: 10px 12px; border-radius: 6px; background: var(--bg-secondary); border: 1px solid var(--border-light); line-height: 1.6; margin-bottom: 10px;">${kurtNote}</div>` : null}
            <div style="position: relative;">
              <canvas id="vc-kurt" style="width: 100%; height: 220px; display: block;"></canvas>
              <div id="vt-kurt" style="position: absolute; display: none; pointer-events: none; z-index: 10; background: var(--surface-menu); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: 4px; padding: 6px 9px; font-size: 12px; line-height: 1.55; white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,.3); font-family: var(--font-mono);"></div>
            </div>
            ${(kurtWarnShow) ? html`<div style="display: flex; align-items: flex-start; gap: 8px; margin-top: 10px; padding: 9px 11px; border-radius: 6px; background: rgba(199,125,10,.1); border: 1px solid rgba(199,125,10,.35); font-size: 11px; color: var(--text-secondary); line-height: 1.55;"><span class="codicon codicon-warning" style="font-size: 13px; color: var(--warning); flex-shrink: 0; margin-top: 1px;"></span><span>${kurtWarn}</span></div>` : null}
          </div>
          <div style="background: var(--bg-primary); border: 1px solid var(--border-default); border-radius: 8px; padding: 16px 18px;">
            <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>결함 대역 에너지 추이 <span style="font-weight: 500; color: var(--text-muted); font-size: 13px;">Band Energy</span></div>
            <!-- 축 전환 — 원값은 계열 간 크기 차가 커 작은 대역이 바닥에 붙음 -->
            <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: -4px 0 12px; flex-wrap: wrap;">
              <div style="font-size: 12px; color: var(--text-muted);">주파수 대역별 에너지의 시간 변화 · 결함 대역 상승 = 결함 성장</div>
              <!-- 학습 없으면 흐리게 — 눌러도 안 켜지고 필요 조건 안내 -->
              <button onClick=${onBandNorm} title=${bandNormReady ? '' : '대역 베이스라인 학습이 필요합니다'} style="height: 26px; padding: 0 11px; border-radius: 6px; font-size: 11.5px; font-weight: 600; white-space: nowrap; font-family: inherit; cursor: pointer; opacity: ${(bandNorm || bandNormReady) ? 1 : .5}; border: 1px solid ${bandNorm ? 'var(--primary-base)' : 'var(--border-medium)'}; background: ${bandNorm ? 'rgba(0,108,210,.1)' : 'var(--bg-elevated)'}; color: ${bandNorm ? 'var(--primary-light)' : 'var(--text-secondary)'};">${bandNormLabel}</button>
            </div>
            ${(bandNormNote) ? html`<div style="font-size: 11px; color: var(--text-muted); margin: -6px 0 10px;">${bandNormNote}</div>` : null}
            ${(bandNote) ? html`<div style="font-size: 11.5px; color: var(--text-muted); padding: 10px 12px; border-radius: 6px; background: var(--bg-secondary); border: 1px solid var(--border-light); line-height: 1.6; margin-bottom: 10px;">${bandNote}</div>` : null}
            <div style="position: relative;">
              <canvas id="vc-band" style="width: 100%; height: 220px; display: block;"></canvas>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 10px; font-size: 11px; color: var(--text-tertiary);">
              <!-- 범례는 계열 목록에서 생성(대역 구성 변화에 자동 추종) -->
              ${(bandLegend || []).map((l) => html`
                <span onClick=${l.onClick} title=${l.on ? '클릭하면 이 대역을 숨깁니다' : '클릭하면 다시 표시합니다'} style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; opacity: ${l.on ? 1 : .35}; text-decoration: ${l.on ? 'none' : 'line-through'};">
                  <span style=${l.dash ? 'width: 12px; height: 0; border-top: 2px dashed ' + l.color + ';' : 'width: 12px; height: 2px; border-radius: 1px; background: ' + l.color + ';'}></span>${l.label}</span>
              `)}
            </div>
          </div>
          ` : null}
        </div>

        <div id="sec-spec" style="display: flex; align-items: center; gap: 10px; margin: 24px 0 12px; flex-wrap: wrap;">
          <span class="codicon codicon-pulse" style="font-size: 14px; color: var(--primary-light);"></span>
          <span style="font-size: 13px; font-weight: 700; letter-spacing: .6px; color: var(--text-primary);">스펙트럼 분석</span>
          <span style="font-size: 11px; color: var(--text-muted);">주파수 성분 분해 · 결함 가설 탐색</span>
          <div style="flex: 1 1 0; min-width: 20px; height: 1px; background: var(--border-light);"></div>
          <span style="font-size: 11px; color: var(--text-muted);">표시 물리량</span>
          <div style="display: flex; background: var(--bg-elevated); border: 1px solid var(--border-default); border-radius: 6px; overflow: hidden;" title="아래 파형·FFT·포락선·스펙트로그램의 표시 물리량 — 가속도↔속도↔변위 변환. 변위=저주파(불균형)·가속도=고주파(베어링) 강조. 추세·등급 판정에는 영향 없음">
            ${(unitChips || []).map((uc) => html`<button onClick=${uc.onClick} title=${uc.title} style=${uc.style}>${uc.label}</button>`)}
          </div>
        </div>

        <div style="background: var(--bg-primary); border: 1px solid var(--border-default); border-radius: 8px; padding: 16px 18px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>원시 파형 <span style="font-weight: 500; color: var(--text-muted); font-size: 13px;">Raw Waveform</span><span style="margin-left: auto; font-size: 11px; color: var(--text-muted); font-weight: 400;"><b style="color: var(--text-tertiary);">휠</b> 확대·축소 · <b style="color: var(--text-tertiary);">드래그</b> 이동 · <b style="color: var(--text-tertiary);">더블클릭</b> 리셋</span></div>
          <div style="font-size: 12px; color: var(--text-muted); margin: -4px 0 12px;">센서가 측정한 시간당 순간 진동 값 · 충격·주기성 패턴을 육안으로 확인</div>
          <div style="position: relative;">
            <canvas id="vc-wave" style="width: 100%; height: 240px; display: block;"></canvas>
            <div id="vx-wave" style="position: absolute; top: 14px; bottom: 34px; width: 1px; background: rgba(0,108,210,.5); display: none; pointer-events: none;"></div>
            <div id="vt-wave" style="position: absolute; display: none; pointer-events: none; z-index: 10; background: var(--surface-menu); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: 4px; padding: 6px 9px; font-size: 12px; line-height: 1.55; white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,.3); font-family: var(--font-mono);"></div>
          </div>
        </div>

        <div style="background: var(--bg-primary); border: 1px solid var(--border-default); border-radius: 8px; padding: 16px 18px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>FFT 주파수 스펙트럼 <span style="font-size: 11px; color: var(--text-muted); font-weight: 400;">${detBearing}</span>${(fftRangeShow) ? html`<span style="margin-left: auto; display: inline-flex; align-items: center; gap: 7px;"><span style="font-size: 11px; color: var(--text-muted); font-weight: 400;">범위</span><span style="display: inline-flex; border: 1px solid var(--border-medium); border-radius: 5px; overflow: hidden;">${(fftRangeChips || []).map((rc) => html`<button onClick=${rc.onClick} style=${rc.style}>${rc.label}</button>`)}</span></span>` : null}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin: -4px 0 12px;">진동을 주파수별 성분으로 분해 · 결함 주파수와 맞춰 가설 수립</div>
          <div style="position: relative;">
            <canvas id="vc-fft" style="width: 100%; height: 280px; display: block;"></canvas>
            <div id="vt-fft" style="position: absolute; display: none; pointer-events: none; z-index: 10; background: var(--surface-menu); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: 4px; padding: 6px 9px; font-size: 12px; line-height: 1.55; white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,.3); font-family: var(--font-mono);"></div>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-light);">
            ${(fftMarkers || []).map((m) => html`
              <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-tertiary);"><span style="width: 12px; height: 2px; background: ${m.color};"></span><b style="color: ${m.color}; font-weight: 600;">${m.label}</b><span style="font-family: var(--font-mono); color: var(--text-muted);">${m.freq}</span></span>
            `)}
          </div>
        </div>

        ${(showAdvanced) ? html`
        <div style="background: var(--bg-primary); border: 1px solid var(--border-default); border-radius: 8px; padding: 16px 18px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>스펙트로그램 <span style="font-weight: 500; color: var(--text-muted); font-size: 13px;">Spectrogram · 시간×주파수</span>${(fftRangeShow) ? html`<span style="margin-left: auto; display: inline-flex; align-items: center; gap: 7px;"><span style="font-size: 11px; color: var(--text-muted); font-weight: 400;">범위</span><span style="display: inline-flex; border: 1px solid var(--border-medium); border-radius: 5px; overflow: hidden;">${(fftRangeChips || []).map((rc) => html`<button onClick=${rc.onClick} style=${rc.style}>${rc.label}</button>`)}</span></span>` : null}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin: -4px 0 12px;">스펙트럼의 시간 변화 · 밝을수록 강한 성분 — 결함 대역이 언제부터 자랐는지 확인</div>
          <div style="position: relative;">
            <canvas id="vc-spec" style="width: 100%; height: 200px; display: block;"></canvas>
          </div>
        </div>

        ${(kurtogramShow) ? html`
        <div style="background: var(--bg-primary); border: 1px solid var(--border-default); border-radius: 8px; padding: 16px 18px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>대역별 충격성 <span style="font-weight: 500; color: var(--text-muted); font-size: 13px;">Kurtogram · Spectral Kurtosis</span></div>
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">${kurtogramHint}</div>
          <div style="position: relative;"><canvas id="vc-kurtogram" style="width: 100%; height: 180px; display: block;"></canvas></div>
        </div>
        ` : null}

        <div style="background: var(--bg-primary); border: 1px solid var(--border-default); border-radius: 8px; padding: 16px 18px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>포락선 분석 <span style="font-weight: 500; color: var(--text-muted); font-size: 13px;">Envelope · 베어링 결함 복조</span></div>
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">${envHint}</div>
          <div style="position: relative;"><canvas id="vc-env" style="width: 100%; height: 210px; display: block;"></canvas></div>
          <div style="display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-light);">
            ${(envMarkers || []).map((m) => html`<span style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-tertiary);"><span style="width: 12px; height: 2px; background: ${m.color};"></span><b style="color: ${m.color}; font-weight: 600;">${m.label}</b><span style="font-family: var(--font-mono); color: var(--text-muted);">${m.freq}</span></span>`)}
          </div>
        </div>

        <div style="background: var(--bg-primary); border: 1px solid var(--border-default); border-radius: 8px; padding: 16px 18px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>켑스트럼 <span style="font-weight: 500; color: var(--text-muted); font-size: 13px;">Cepstrum · ms</span></div>
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">${cepNote}</div>
          <div style="position: relative;"><canvas id="vc-cep" style="width: 100%; height: 200px; display: block;"></canvas></div>
        </div>
        ` : null}

        <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 16px 18px;">
          <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>${indicsTitle}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px;">${indicsDesc}</div>
          <div style="display: flex; flex-wrap: wrap; gap: 10px;">
            ${(specIndics || []).map((s) => html`
              <div style="flex: 1 1 160px; padding: 13px 16px; border: 1px solid var(--border-light); border-radius: 8px;">
                <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">${s.k}</div>
                <div style="font-size: 20px; font-weight: 700; color: var(--text-primary); font-family: var(--font-mono);">${s.v} <span style="font-size: 10px; font-weight: 500; color: var(--text-muted); font-family: var(--font-sans);">${s.hint}</span></div>
                <div style="font-size: 10px; color: var(--text-muted); margin-top: 6px; line-height: 1.5;">${s.desc}</div>
              </div>
            `)}
          </div>
        </div>
      </div>
    ` : null}

    ${(monEventsShow) ? html`
      <div style="max-width: 1360px; margin: -24px auto 0; padding: 0 20px 40px;">





        <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 18px;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary);"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>이벤트 <span style="font-size: 12px; font-weight: 500; color: var(--text-muted);">${evtCount}건</span></div>
            <div style="display: flex; gap: 6px;">${(evtScopeChips || []).map((c) => html`<button onClick=${c.onClick} style=${c.style}>${c.label}</button>`)}</div>
            <div style="margin-left: auto; display: flex; gap: 8px;">
              <select value=${evtTagFilter} onChange=${onEvtTag} style="height: 32px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-secondary); font-size: 12px; cursor: pointer;">${(evtTagOptions || []).map((o) => html`<option value=${o.id}>${o.label}</option>`)}</select>
              <select value=${evtTypeFilter} onChange=${onEvtType} style="height: 32px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-secondary); font-size: 12px; cursor: pointer;">${(evtTypeOptions || []).map((o) => html`<option value=${o.id}>${o.label}</option>`)}</select>
              <button onClick=${onOpenDownload} title="이벤트 기록 내보내기" style="height: 32px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-secondary); font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;"><span class="codicon codicon-desktop-download" style="font-size: 13px;"></span>저장</button>
            </div>
          </div>

          <div style="overflow: auto; max-height: 540px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
              <thead style="position: sticky; top: 0; background: var(--bg-secondary); z-index: 1;">
                <tr>
                  <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); font-size: 12px; padding: 10px 12px; border-bottom: 1px solid var(--border-default); white-space: nowrap;">시각</th>
                  <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); font-size: 12px; padding: 10px 12px; border-bottom: 1px solid var(--border-default);">태그</th>
                  <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); font-size: 12px; padding: 10px 12px; border-bottom: 1px solid var(--border-default); white-space: nowrap;">유형</th>
                  <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); font-size: 12px; padding: 10px 12px; border-bottom: 1px solid var(--border-default); white-space: nowrap;">상세</th>
                  <th style="text-align: center; font-weight: 600; color: var(--text-tertiary); font-size: 12px; padding: 10px 12px; border-bottom: 1px solid var(--border-default);">등급</th>
                </tr>
              </thead>
              <tbody>
                ${(evtRows || []).map((r) => html`
                  <tr onClick=${r.onGo} title="상세분석으로 이동" style="border-bottom: 1px solid var(--border-light); cursor: pointer;" class="vhov4">
                    <td style="padding: 10px 12px 10px 13px; white-space: nowrap; border-left: 3px solid ${r.gradeColor};"><div style="color: var(--text-secondary); font-family: var(--font-mono); font-size: 12px;">${r.timeText}</div><div style="color: var(--text-muted); font-size: 11px; margin-top: 1px;">${r.agoText}</div></td>
                    <td style="padding: 10px 12px; color: var(--text-secondary);"><div style="font-weight: 500; color: var(--text-primary);">${r.tagAlias}</div><div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${r.tagName}</div></td>
                    <td style="padding: 10px 12px; color: var(--text-secondary); white-space: nowrap;">${r.typeKo}</td>
                    <td data-tip=${r.valTip || ''} style="padding: 10px 12px; white-space: nowrap;${r.valTip ? ' cursor: help;' : ''}"><span style="color: var(--text-primary); font-weight: 600; font-family: var(--font-mono);">${r.valText}</span>${(r.noteText) ? html`<span style="color: var(--text-muted); font-size: 11px;"> · ${r.noteText}</span>` : null}</td>
                    <td style="padding: 10px 12px; text-align: center;"><span style="padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; color: ${r.gradeColor}; background: ${r.gradeSoft};">${r.gradeKo}</span></td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
          ${(evtEmpty) ? html`<div style="padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px;">${evtEmptyText}</div>` : null}
          ${(evtCapped) ? html`<div style="padding: 10px 4px 2px; text-align: center; color: var(--text-muted); font-size: 11px;">최근 200건만 표시합니다 — 전체 이력은 <b style="color: var(--text-secondary);">저장</b>(내보내기)에서 확인하세요</div>` : null}
        </div>
      </div>
    ` : null}

    ${(reportEmptyShow) ? html`
      <div style="max-width: 1360px; margin: 0 auto; padding: 18px 20px 40px;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; min-height: 440px; background: var(--bg-secondary); border: 1px dashed var(--border-default); border-radius: 10px; text-align: center; padding: 40px 24px;">
          <span class="codicon codicon-database" style="font-size: 34px; color: var(--text-muted);"></span>
          <div style="font-size: 16px; font-weight: 600; color: var(--text-primary);">리포트 대상이 없습니다</div>
          <div style="font-size: 13px; color: var(--text-muted); max-width: 400px; line-height: 1.6;">설정 › 데이터 소스에서 TAG table을 선택하면 리포트를 생성할 수 있습니다.</div>
          <button onClick=${onGoSource} style="display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 16px; border-radius: 6px; border: none; background: var(--primary-base); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;"><span class="codicon codicon-arrow-right" style="font-size: 14px;"></span>데이터 소스 설정</button>
        </div>
      </div>
    ` : null}

    ${(reportShow) ? html`
      <div data-screen-label="리포트 생성" style="max-width: 1360px; margin: 0 auto; padding: 18px 20px 40px;">

        <div style="display: grid; grid-template-columns: minmax(340px, 400px) 1fr; gap: 16px; align-items: start;">
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 18px;">
            <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 16px;"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>리포트 생성</div>
            <div style="display: flex; align-items: center; font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 8px;">대상 태그 <span style="color: var(--primary-light); margin-left: 4px;">${genTagsCount}개 선택</span><button onClick=${onGenSelectAll} style="margin-left: auto; height: 24px; padding: 0 10px; border-radius: 4px; border: 1px solid var(--border-medium); background: transparent; color: var(--text-secondary); font-size: 11px; font-weight: 600; cursor: pointer;">${genSelAllLabel}</button></div>
            <div style="max-height: 220px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: 6px; padding: 5px; margin-bottom: 16px;">
              ${(reportTags || []).map((t) => html`
                <div onClick=${t.onToggle} style=${t.rowStyle}>
                  <span style=${t.boxStyle}>${(t.checked) ? html`<span class="codicon codicon-check" style="font-size: 12px;"></span>` : null}</span>
                  <span style="min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"><span style="font-size: 13px; color: var(--text-primary);">${t.alias}</span> <span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${t.nameSub}</span></span>
                </div>
              `)}
            </div>
            <div style="font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 8px;">기간</div>
            ${(genPeriodNone) ? html`
              <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 16px; font-size: 11px; color: var(--text-muted);"><span class="codicon codicon-info" style="font-size: 12px;"></span>대상 태그를 선택하면 기간을 정할 수 있습니다</div>
            ` : null}
            ${(genPeriodShow) ? html`
              <div style="display: flex; background: var(--bg-elevated); border: 1px solid var(--border-default); border-radius: 6px; overflow: hidden; margin-bottom: 8px; width: fit-content;">
                ${(genPeriodPresets || []).map((p) => html`<button onClick=${p.onClick} title=${p.title} style=${p.style}>${p.label}</button>`)}
              </div>
              <div style="margin-bottom: 8px;"><${DateRange} ...${genRange} /></div>
              <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 16px; font-size: 11px; color: var(--text-muted);"><span class="codicon codicon-${genPeriodCustomShow ? 'info' : 'calendar'}" style="font-size: 12px;"></span>${genPeriodNote}</div>
            ` : null}
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
              <div style=${genToggleStyle} onClick=${onToggleGenLLM}><div style=${genKnobStyle}></div></div>
              <span style="font-size: 13px; color: var(--text-secondary);">LLM 소견 포함</span>
              ${(llmProvsAvail) ? html`<select value=${llmProviderSel} onChange=${onLlmProvPick} style="height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; cursor: pointer;"><option value="">— 프로바이더 —</option>${(llmProvOptions || []).map((o) => html`<option value=${o.id}>${o.label}</option>`)}</select>` : null}
            </div>
            ${(genNoDataShow) ? html`
              <div style="display: flex; align-items: flex-start; gap: 9px; padding: 11px 13px; margin-bottom: 10px; border-radius: 7px; background: rgba(199,125,10,.1); border: 1px solid rgba(199,125,10,.4);">
                <span class="codicon codicon-warning" style="font-size: 14px; color: var(--warning); margin-top: 1px; flex-shrink: 0;"></span>
                <div style="font-size: 11.5px; color: var(--text-secondary); line-height: 1.6;">${genNoDataText}</div>
              </div>
            ` : null}
            ${(genLLMNotice) ? html`<div style="font-size: 11px; color: var(--warning); margin-bottom: 6px;">${genLLMNotice}</div>` : null}
            <div style="margin-top: 14px;"></div>
            <button onClick=${onGenReport} style=${genBtnStyle}><span class="codicon codicon-file-add" style="font-size: 14px; vertical-align: -2px; margin-right: 6px;"></span>${genBtnLabel}</button>
            ${(genRunning) ? html`
              <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-light); display: flex; flex-direction: column; gap: 12px;">
                ${(genSteps || []).map((s) => html`<div style="display: flex; align-items: center; gap: 10px;"><span style=${s.dotStyle}>${s.num}</span><span style=${s.labelStyle}>${s.label}</span></div>`)}
              </div>
              <button onClick=${onCancelGen} style=${genCancelStyle}><span class="codicon codicon-stop-circle" style="font-size: 13px; vertical-align: -2px; margin-right: 5px;"></span>${genCancelLabel}</button>
            ` : null}
          </div>

          <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 18px;">
            <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 14px;"><span style="width: 3px; height: 15px; border-radius: 2px; background: var(--primary-base);"></span>보관함</div>
            <div style="overflow-x: auto;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead><tr>
                  <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); font-size: 12px; padding: 10px 12px; border-bottom: 1px solid var(--border-default); white-space: nowrap;">생성일시</th>
                  <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); font-size: 12px; padding: 10px 12px; border-bottom: 1px solid var(--border-default); white-space: nowrap;">리포트명</th>
                  <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); font-size: 12px; padding: 10px 12px; border-bottom: 1px solid var(--border-default); white-space: nowrap;">기간</th>
                  <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); font-size: 12px; padding: 10px 12px; border-bottom: 1px solid var(--border-default); white-space: nowrap;">유형</th>
                  <th style="text-align: right; font-weight: 600; color: var(--text-tertiary); font-size: 12px; padding: 10px 12px; border-bottom: 1px solid var(--border-default);"></th>
                </tr></thead>
                <tbody>
                  ${(reportRows || []).map((r) => html`
                    <tr style="border-bottom: 1px solid var(--border-light);">
                      <td style="padding: 11px 12px; color: var(--text-tertiary); font-family: var(--font-mono); font-size: 12px; white-space: nowrap;">${r.dateText}</td>
                      <td style="padding: 11px 12px; color: var(--text-primary); font-weight: 500; white-space: nowrap;" title=${r.tagsText}>${r.nameText}</td>
                      <td style="padding: 11px 12px; color: var(--text-secondary); white-space: nowrap;">${r.period}</td>
                      <td style="padding: 11px 12px; white-space: nowrap;"><span style="display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 600; color: ${r.llmColor}; background: ${r.llmBg};">${r.llmText}</span></td>
                      <td style="padding: 11px 12px; text-align: right; white-space: nowrap;">
                        <button onClick=${r.onOpen} title="미리보기" style="width: 28px; height: 28px; border-radius: 5px; border: 1px solid var(--border-default); background: var(--bg-elevated); color: var(--text-secondary); cursor: pointer; margin-left: 4px;"><span class="codicon codicon-eye" style="font-size: 13px;"></span></button>
                        <button onClick=${r.onDelete} title="삭제" style="width: 28px; height: 28px; border-radius: 5px; border: 1px solid var(--border-default); background: var(--bg-elevated); color: var(--danger); cursor: pointer; margin-left: 4px;"><span class="codicon codicon-trash" style="font-size: 13px;"></span></button>
                      </td>
                    </tr>
                  `)}
                </tbody>
              </table>
            </div>
            ${(reportEmpty) ? html`<div style="padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px;">저장된 리포트가 없습니다</div>` : null}
            ${(rpPagerShow) ? html`
              <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 12px;">
                <button onClick=${onRpPrev} title="이전" style=${rpBtnStyle}><span class="codicon codicon-chevron-left" style="font-size: 13px;"></span></button>
                <span style="font-size: 12px; color: var(--text-tertiary); font-family: var(--font-mono);">${rpPageText}</span>
                <button onClick=${onRpNext} title="다음" style=${rpBtnStyle}><span class="codicon codicon-chevron-right" style="font-size: 13px;"></span></button>
              </div>
            ` : null}
          </div>
        </div>
      </div>
    ` : null}

    ${(isSettings) ? html`
      <div data-screen-label="설정" style="max-width: 1180px; margin: 0 auto; padding: 18px 20px 60px; display: grid; grid-template-columns: 190px 1fr; gap: 22px; align-items: start;">
        <div style="position: sticky; top: 16px; display: flex; flex-direction: column; gap: 2px;">
          <div style="font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--text-muted); padding: 4px 12px 10px;">설정</div>
          ${(setNav || []).map((n) => html`<div onClick=${n.onClick} style=${n.style}><span class="codicon codicon-${n.icon}" style="font-size: 15px;"></span>${n.label}${(n.badge) ? html`<span style="margin-left: auto; padding: 1px 7px; border-radius: 8px; font-size: 10px; font-weight: 700; color: #d99a2b; background: rgba(217,154,43,0.15); white-space: nowrap;">${n.badge}</span>` : null}</div>`)}
        </div>

        <div onChange=${onFormChange}>
          ${(secSource) ? html`
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 20px; margin-bottom: 16px;">
              <div style="font-size: 17px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">유저 정보</div>
              <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 18px;">Neo 콘솔에 로그인한 계정으로 동작합니다. 보이는 테이블과 저장되는 설정이 계정마다 따로입니다</div>

              ${(userName) ? html`
                <div style="display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 8px; background: var(--bg-elevated); border: 1px solid var(--border-light);">
                  <span class="codicon codicon-pass-filled" style="font-size: 15px; color: var(--success, #3fa45b);"></span>
                  <span style="font-size: 13px; color: var(--text-secondary);">접속 계정</span>
                  <span style="font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--text-primary);">${userName}</span>
                  <span style="margin-left: auto; font-size: 11.5px; color: var(--text-muted);">계정을 바꾸려면 Neo 콘솔에서 다시 로그인하세요</span>
                </div>` : null}

              ${(userAuthMsg) ? html`
                <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border-radius: 8px; background: rgba(217,154,43,0.10); border: 1px solid rgba(217,154,43,0.35);">
                  <span class="codicon codicon-warning" style="font-size: 15px; color: #d99a2b; margin-top: 1px;"></span>
                  <div style="font-size: 12.5px; color: var(--text-secondary); line-height: 1.6;">${userAuthMsg}<div style="color: var(--text-muted); margin-top: 3px;">로그인이 확인되기 전에는 어떤 데이터도 조회하지 않습니다.</div></div>
                </div>` : null}

              ${(dbReady) ? html`
                <div style="display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 8px; background: var(--bg-elevated); border: 1px solid var(--border-light); margin-top: 10px;">
                  <span class="codicon codicon-pass-filled" style="font-size: 15px; color: var(--success, #3fa45b);"></span>
                  <span style="font-size: 13px; color: var(--text-secondary);">저장소</span>
                  <span style="font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--text-primary);">${dbName}</span>
                  <span style="margin-left: auto; font-size: 11.5px; color: var(--text-muted);">설정·이벤트·학습값이 이 계정 스키마에 저장됩니다</span>
                </div>` : null}

              ${(needsDb) ? html`
                <div style="padding: 13px 15px; border-radius: 8px; background: rgba(217,154,43,0.10); border: 1px solid rgba(217,154,43,0.35); margin-top: 10px;">
                  <div style="display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--text-secondary); line-height: 1.6;">
                    <span class="codicon codicon-database" style="font-size: 15px; color: #d99a2b; flex-shrink: 0;"></span>
                    <span>${(!dbAdmin)
                      /* 비관리자에겐 "없음" 단정 안 함 — V$DATABASES가 계정별로 걸러져 "없음"·"안 보임" 구분 불가 */
                      ? html`설정·판정 기준·이벤트 이력을 저장할 데이터베이스 <code style="font-family: var(--font-mono); font-weight: 600; color: var(--text-primary); user-select: all;">${dbName}</code> 에 접근할 수 없습니다.`
                      : (dbExists)
                        ? html`데이터베이스 <code style="font-family: var(--font-mono); font-weight: 600; color: var(--text-primary); user-select: all;">${dbName}</code> 는 있지만 이 계정에 권한이 없습니다.`
                        : html`설정·판정 기준·이벤트 이력을 저장할 데이터베이스 <code style="font-family: var(--font-mono); font-weight: 600; color: var(--text-primary); user-select: all;">${dbName}</code> 가 없습니다.`}</span>
                  </div>
                  ${(!dbAdmin) ? html`<div style="font-size: 12px; color: var(--text-muted); margin: 5px 0 0 24px;">관리자에게 ${dbName} 권한을 요청하고, 받으셨다면 확인을 누르세요.</div>` : null}
                  ${(dbWhy) ? html`<div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin: 5px 0 0 24px;">${dbWhy}</div>` : null}
                  <div style="display: flex; gap: 8px; margin: 11px 0 0 24px;">
                    ${(dbAdmin && !dbExists) ? html`
                      <button onClick=${onMakeDb} disabled=${dbBusy}
                        style="height: 30px; padding: 0 15px; border-radius: 6px; border: none; background: var(--primary-base); color: #fff; font-size: 12.5px; font-weight: 600; cursor: ${dbBusy ? 'wait' : 'pointer'}; opacity: ${dbBusy ? '.6' : '1'};">${dbBusy ? '만드는 중…' : '만들기'}</button>` : null}
                    <button onClick=${onCheckDb} disabled=${dbBusy}
                      style="height: 30px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--border-medium); background: transparent; color: var(--text-secondary); font-size: 12.5px; cursor: ${dbBusy ? 'wait' : 'pointer'}; opacity: ${dbBusy ? '.6' : '1'};">상태 확인</button>
                  </div>
                </div>` : null}

              ${(dbAdmin) ? html`
                <div style="margin-top: 10px; padding: 12px 14px; border-radius: 8px; background: var(--bg-elevated); border: 1px solid var(--border-light);">
                  <div style="font-size: 11.5px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 8px;">패키지 사용 계정에 권한 주기 <span style="font-weight: 400; color: var(--text-muted);">— 계정마다 한 번</span></div>
                  <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <select onChange=${onGrantPick} onFocus=${onGrantOpen} value=${grantPick} disabled=${grantBusy}
                      style="height: 30px; min-width: 150px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-secondary); color: var(--text-primary); font-family: var(--font-mono); font-size: 12.5px;">
                      ${(grantUsers && grantUsers.length)
                        ? grantUsers.map((u) => html`<option value=${u}>${u}</option>`)
                        : html`<option value="">${grantUsers ? '다른 계정이 없습니다' : '불러오는 중…'}</option>`}
                    </select>
                    <button onClick=${onGrantRun} disabled=${grantBusy || !grantPick}
                      style="height: 30px; padding: 0 15px; border-radius: 6px; border: none; background: var(--primary-base); color: #fff; font-size: 12.5px; font-weight: 600; cursor: ${(grantBusy || !grantPick) ? 'not-allowed' : 'pointer'}; opacity: ${(grantBusy || !grantPick) ? '.6' : '1'};">${grantBusy ? '주는 중…' : '권한 주기'}</button>
                    ${(grantMsg) ? html`<span style="font-size: 11.5px; color: var(--text-muted);">${grantMsg}</span>` : null}
                  </div>
                  <details style="margin-top: 10px;">
                    <summary style="font-size: 11.5px; color: var(--text-muted); cursor: pointer; user-select: none;">SQL 로 직접 하기</summary>
                    <pre style="margin: 7px 0 0; font-family: var(--font-mono); font-size: 12px; line-height: 1.7; color: var(--text-secondary); white-space: pre-wrap; user-select: all;">${dbGrantSql}</pre>
                  </details>
                </div>` : null}
            </div>` : null}

          ${(secSource) ? html`
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 20px; margin-bottom: 16px;">
              <div style="font-size: 17px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">표시 시간대</div>
              <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px;">화면·리포트·알림에 찍히는 시각과 "오늘"·날짜 선택의 기준입니다. 데이터 조회는 시간대와 무관하게 같은 순간을 봅니다</div>
              <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <select value=${tzValue} onChange=${onTzChange} style="height: 32px; min-width: 260px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-primary); color: var(--text-primary); font-size: 13px;">
                  ${(tzOptions || []).map((o) => html`<option value=${o.v}>${o.l}</option>`)}
                </select>
                <span style="font-size: 12px; color: var(--text-muted);">${tzNow}</span>
              </div>
            </div>` : null}

          ${(secSource) ? html`
                        <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 20px; margin-bottom: 16px;">
              <div style="font-size: 17px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">데이터 소스</div>
              <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 18px;">진동 데이터가 저장된 TAG table을 고르고 태그 별칭을 지정합니다</div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 28px;">
                <div>
                  <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px;"><label style="font-size: 12px; font-weight: 600; color: var(--text-tertiary);">테이블 선택 (멀티)</label><span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${srcSelCount} / ${srcTotal} 선택</span><button onClick=${onSrcSelectAll} style="margin-left: auto; height: 24px; padding: 0 10px; border-radius: 4px; border: 1px solid var(--border-medium); background: transparent; color: var(--text-secondary); font-size: 11px; font-weight: 600; cursor: pointer;">${srcSelAllLabel}</button></div>
                  <div style="display: flex; flex-direction: column; gap: 4px; max-height: 208px; overflow-y: auto; padding-right: 4px;">
                    ${(srcTables || []).map((t) => html`
                      <label title=${t.blockReason} style="display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border-light); border-radius: 6px; cursor: ${t.blocked ? 'not-allowed' : 'pointer'}; opacity: ${t.blocked ? '.55' : '1'};">
                        <input type="checkbox" checked=${t.checked} disabled=${t.blocked} onChange=${t.onToggle} style="width: 15px; height: 15px; accent-color: var(--primary-base);" />
                        <span style="min-width: 0;">
                          <span style="font-family: var(--font-mono); font-size: 13px; color: var(--text-primary);">${t.name}</span>
                          ${(t.blocked) ? html`<span style="display: block; font-size: 10.5px; color: var(--warning); line-height: 1.5; margin-top: 1px;">${t.blockReason}</span>` : null}
                        </span>
                        <span style="margin-left: auto; flex-shrink: 0; font-size: 9px; font-weight: 700; color: #fff; background: ${t.blocked ? 'var(--text-muted)' : t.kindColor}; border-radius: 3px; padding: 1px 6px;">${t.kind}</span>
                      </label>
                    `)}
                  </div>
                </div>
                <div>
                  <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 8px;">컬럼 구성</label>
                  <div style="font-size: 12px; color: var(--text-muted); line-height: 1.7; padding: 10px 12px; border-radius: 6px; background: var(--bg-secondary); border: 1px solid var(--border-light);">
                    표준 스키마 <span style="font-family: var(--font-mono); color: var(--text-secondary);">NAME · TIME · VALUE</span> 기준으로 조회합니다. 다른 컬럼명을 쓰는 TAG table은 아직 지원하지 않습니다.
                  </div>
                </div>
              </div>
              ${(capShow) ? html`
                <div style="margin-top: 16px; padding: 12px 14px; border-radius: 8px; background: rgba(217,154,43,0.12); border: 1px solid rgba(217,154,43,0.35);">
                  <div style="display: flex; align-items: flex-start; gap: 10px;">
                    <span class="codicon codicon-warning" style="font-size: 15px; color: #d99a2b; flex-shrink: 0; margin-top: 1px;"></span>
                    <div>
                      <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;">${capText}</div>
                      <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px; line-height: 1.6;">${capHint}</div>
                    </div>
                  </div>
                  <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; padding-left: 25px;">
                    ${(capRows || []).map((r) => html`
                      <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; padding: 4px 9px; border-radius: 5px; background: var(--bg-elevated); border: 1px solid var(--border-light);">
                        <span style="font-family: var(--font-mono); color: var(--text-secondary);">${r.table}</span>
                        <span style="color: var(--text-muted);">${r.count}</span>
                        <span style="color: #d99a2b; font-weight: 600;">${r.dropped}</span>
                      </span>
                    `)}
                  </div>
                </div>
              ` : null}
            </div>
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 20px;">
              <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
                <label style="font-size: 12px; font-weight: 600; color: var(--text-tertiary);">태그 별칭 편집</label>
                <span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${aliasCountText}</span>
                <div style="margin-left: auto; position: relative;"><span class="codicon codicon-search" style="position: absolute; left: 9px; top: 8px; font-size: 13px; color: var(--text-muted);"></span><input value=${tagQuery} onInput=${onTagQuery} placeholder="태그 검색" style="height: 30px; width: 200px; padding: 0 10px 0 28px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px;" /></div>
              </div>
              <div onScroll=${onAliasScroll} style="max-height: 320px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                  <thead><tr><th style="text-align: left; font-weight: 600; color: var(--text-tertiary); font-size: 12px; padding: 8px 10px; border-bottom: 1px solid var(--border-default);">원명 (NAME)</th><th style="text-align: left; font-weight: 600; color: var(--text-tertiary); font-size: 12px; padding: 8px 10px; border-bottom: 1px solid var(--border-default);">별칭</th></tr></thead>
                  <tbody>
                    ${(aliasRows || []).map((r) => html`
                      <tr style="border-bottom: 1px solid var(--border-light);">
                        <td style="padding: 6px 10px; font-family: var(--font-mono); font-size: 12px; color: var(--text-tertiary); white-space: nowrap;">
                          ${r.name}
                          ${(r.offCap) ? html`<span style="margin-left: 8px; font-family: var(--font-sans); font-size: 10px; font-weight: 600; color: #d99a2b; background: rgba(217,154,43,0.15); border-radius: 4px; padding: 1px 6px;">감시 제외</span>` : null}
                        </td>
                        <td style="padding: 6px 10px;"><input value=${r.alias} onChange=${r.onAlias} placeholder=${r.aliasPlaceholder} style="height: 30px; width: 100%; max-width: 240px; padding: 0 10px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px;" /></td>
                      </tr>
                    `)}
                  </tbody>
                </table>
                ${(aliasEmpty) ? html`<div style="padding: 18px 10px; font-size: 12px; color: var(--text-muted); text-align: center;">검색과 일치하는 태그가 없습니다</div>` : null}
                ${(aliasMoreText) ? html`<div style="padding: 12px 10px; font-size: 12px; color: var(--text-muted); text-align: center;">${aliasMoreText}</div>` : null}
              </div>
            </div>
          ` : null}

          ${(secEquip) ? html`
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 20px;">
              <div style="display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; flex-wrap: wrap;">
                <div style="font-size: 17px; font-weight: 600; color: var(--text-primary);">설비 정보</div>
                <div style="font-size: 12px; color: var(--text-muted);">한 번만 설정하면 유지되는 정보입니다</div>
              </div>
              <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 14px; line-height: 1.6; max-width: 740px;">베어링 모델을 선택하면 형상값이 자동 입력되고 결함 주파수(BPFO/BPFI/BSF/FTF)가 자동 계산됩니다. 오른쪽 <b style="color: var(--text-primary); font-weight: 600;">설정</b> 버튼 안에 <b style="color: var(--text-primary); font-weight: 600;">마운팅 방식·구동방식·날개수</b>가 있습니다 — 채운 만큼 판정 가능한 결함 종류가 늘어납니다. 버튼의 <span style="font-family: var(--font-mono); font-size: 11px;">n/N</span>은 입력 완성도이며, 항목 옆 <span class="codicon codicon-question" style="font-size: 11px;"></span> 에 마우스를 올리면 설명이 나옵니다.</div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px;">
                <div style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-secondary); background: var(--bg-elevated); border: 1px solid var(--border-light); border-radius: 5px; padding: 5px 10px;"><span class="codicon codicon-database" style="font-size: 12px; color: var(--text-muted);"></span>데이터 소스 ${srcSelCount}개 · 태그 ${activeCount}개 · 별칭 없으면 NAME 표시</div>
                <!-- 계통주파수 — 평소 숨김(국내 60 Hz), 50 설정이거나 RPM이 다른 계통을 가리킬 때만 표시 -->
                ${(lineHzShow) ? html`
                  <label data-tip=${helpTip['전원 계통주파수']} style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-secondary); background: var(--bg-elevated); border: 1px solid ${lineHzHint && lineHzHint.warn ? '#d99a2b' : 'var(--border-light)'}; border-radius: 5px; padding: 4px 10px; cursor: help;">전원 계통주파수<span class="codicon codicon-question" style="font-size: 10px; color: var(--text-muted);"></span>
                    <select value=${lineHz} onChange=${onLineHz} style="height: 24px; padding: 0 4px; border-radius: 4px; border: 1px solid var(--border-medium); background: var(--bg-primary); color: var(--text-primary); font-size: 11px;"><option value="60">60 Hz</option><option value="50">50 Hz</option></select>
                    <span style="color: var(--text-muted);">→ 전기적 결함 ${lineHz === '50' ? '100' : '120'} Hz</span>
                    ${(lineHzHint) ? html`<span style="color: ${lineHzHint.warn ? '#d99a2b' : 'var(--text-muted)'};">· ${lineHzHint.text}</span>` : null}
                  </label>
                ` : null}
              </div>
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 16px;">
                <span style="font-size: 11px; color: var(--text-muted); margin-right: 2px;">Class (ISO 10816)</span>
                <span style="font-size: 11px; color: var(--text-secondary); background: var(--bg-elevated); border: 1px solid var(--border-light); border-radius: 4px; padding: 3px 9px;"><b style="color: var(--text-primary);">I</b> 소형 ≤ 15kW</span>
                <span style="font-size: 11px; color: var(--text-secondary); background: var(--bg-elevated); border: 1px solid var(--border-light); border-radius: 4px; padding: 3px 9px;"><b style="color: var(--text-primary);">II</b> 중형 15–75kW</span>
                <span style="font-size: 11px; color: var(--text-secondary); background: var(--bg-elevated); border: 1px solid var(--border-light); border-radius: 4px; padding: 3px 9px;"><b style="color: var(--text-primary);">III</b> 대형·강성 기초</span>
                <span style="font-size: 11px; color: var(--text-secondary); background: var(--bg-elevated); border: 1px solid var(--border-light); border-radius: 4px; padding: 3px 9px;"><b style="color: var(--text-primary);">IV</b> 대형·연성 기초</span>
              </div>
              ${/* 목록 필터 — 좌측 내비 '판정 불가' 배지와 같은 기준 */ ''}
              <div style="display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 14px;">
                ${(equipFilters || []).map((f) => html`
                  <div data-tip=${f.tip} onClick=${f.onClick} style=${f.style}>${f.label}<span style="font-family: var(--font-mono); font-size: 11px; opacity: .75;">${f.count}</span></div>
                `)}
              </div>
              <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; min-width: 800px;">
                  <thead><tr>
                    <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); padding: 8px 8px; border-bottom: 1px solid var(--border-default); white-space: nowrap;">태그</th>
                    <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); padding: 8px 8px; border-bottom: 1px solid var(--border-default);"><span data-tip=${helpTip['단위']} style="cursor: help; display: inline-flex; align-items: center; gap: 4px;">단위<span class="codicon codicon-question" style="font-size: 11px; color: var(--text-muted);"></span></span></th>
                    <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); padding: 8px 8px; border-bottom: 1px solid var(--border-default);"><span data-tip=${helpTip['Class']} style="cursor: help; display: inline-flex; align-items: center; gap: 4px;">Class<span class="codicon codicon-question" style="font-size: 11px; color: var(--text-muted);"></span></span></th>
                    <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); padding: 8px 8px; border-bottom: 1px solid var(--border-default);"><span data-tip=${helpTip['RPM']} style="cursor: help; display: inline-flex; align-items: center; gap: 4px;">RPM<span class="codicon codicon-question" style="font-size: 11px; color: var(--text-muted);"></span></span></th>
                    <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); padding: 8px 8px; border-bottom: 1px solid var(--border-default);"><span data-tip=${helpTip['베어링 모델']} style="cursor: help; display: inline-flex; align-items: center; gap: 4px;">베어링 모델<span class="codicon codicon-question" style="font-size: 11px; color: var(--text-muted);"></span></span></th>
                    <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); padding: 8px 8px; border-bottom: 1px solid var(--border-default);">형상·계측·구동</th>
                  </tr></thead>
                  <tbody>
                    ${(equipRows || []).map((r) => html`
                      <tr style="border-bottom: 1px solid var(--border-light);">
                        <td style="padding: 5px 8px; white-space: nowrap;"><div style="font-size: 13px; color: var(--text-primary); font-weight: 500;">${r.alias}${(r.unset) ? html`<span title="설비 정보 미설정 — 기본값 적용 중" style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #d99a2b; margin-left: 6px; vertical-align: 2px;"></span>` : null}</div><div style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">${r.name}</div></td>
                        <td style="padding: 5px 8px;"><select value=${r.unit} onChange=${r.onUnit} style="height: 30px; padding: 0 6px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px;"><option value="">— 선택 —</option>${(unitOptions || []).map((u) => html`<option value=${u}>${u}</option>`)}</select></td>
                        <td style="padding: 5px 8px;"><select value=${r.cls} onChange=${r.onCls} style="height: 30px; width: 116px; padding: 0 6px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px;">${(r.clsOptions || []).map((c) => html`<option value=${c.v}>${c.l}</option>`)}</select></td>
                        <td style="padding: 5px 8px;"><div data-tip=${r.rpmTagTip || undefined} style="position: relative; display: inline-block;"><input value=${r.rpm} onChange=${r.onRpm} placeholder="예: 1750" style="height: 30px; width: ${r.rpmTag ? 84 : 72}px; padding: 0 ${r.rpmTag ? 36 : 8}px 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);" />${(r.rpmTag) ? html`<span style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); font-size: 10px; font-weight: 700; color: var(--text-muted); background: var(--bg-primary); border-radius: 3px; padding: 1px 5px; pointer-events: none;">${r.rpmTag}</span>` : null}</div></td>
                        <td style="padding: 5px 8px;"><select value=${r.bModel} onChange=${r.onModel} data-tip=${r.bModelTitle || undefined} style="height: 30px; width: 150px; padding: 0 6px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);"><option value="">— 선택 —</option>${(r.bModelOptions || []).map((o) => html`<option value=${o}>${o === '직접 입력' ? r.bCustomLabel : o}</option>`)}</select></td>
                        <td style="padding: 5px 8px; white-space: nowrap;"><div style="display: flex; align-items: center; gap: 6px;"><button onClick=${r.onToggleAdv} style="display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 5px; border: 1px solid ${(r.setIncomplete && !r.adv) ? '#d99a2b' : 'var(--border-medium)'}; background: var(--bg-elevated); color: var(--text-secondary); font-size: 11px; font-weight: 500; cursor: pointer;"><span class="codicon codicon-settings-gear" style="font-size: 12px; color: var(--text-muted);"></span>${r.advLabel}${(!r.adv) ? html`<span style="font-size: 10px; font-weight: 700; font-family: var(--font-mono); color: ${r.setIncomplete ? '#d99a2b' : 'var(--text-muted)'}; background: var(--bg-primary); border-radius: 3px; padding: 1px 5px;">${r.setCount}/${r.setTotal}</span><span style="font-size: 9px; color: var(--text-muted);">▾</span>` : null}</button><button data-tip="이 행의 값을 다른 태그에 복사합니다 — 한 설비의 X/Y/Z 채널은 RPM·베어링·마운팅이 같습니다." onClick=${r.onToggleBulk} style=${r.bulkBtnStyle}><span class="codicon codicon-copy" style="font-size: 12px;"></span></button></div></td>
                      </tr>
                      ${(r.bulkOpen) ? html`
                        <tr style="border-bottom: 1px solid var(--border-light); background: var(--bg-elevated);">
                          <td colspan="6" style="padding: 14px 16px;">
                            ${(r.bulkNone) ? html`
                              <div style="font-size: 12px; color: var(--text-muted);">이 행에 복사할 값이 없습니다 — 단위·Class·RPM·베어링·마운팅 중 하나를 먼저 채우세요.</div>
                            ` : html`
                              <div style="font-size: 10px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px;">복사할 항목 <span style="font-weight: 500; text-transform: none; letter-spacing: 0;">· 눌러서 끄고 켭니다</span></div>
                              <div style="display: flex; gap: 7px; flex-wrap: wrap;">
                                ${(r.bulkFields || []).map((f) => html`
                                  <div onClick=${f.onToggle} style=${f.style}>${f.label}<span style=${f.valStyle}>${f.val}</span></div>
                                `)}
                              </div>
                              <div style="font-size: 10px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: var(--text-muted); margin: 14px 0 8px;">대상</div>
                              ${(r.bulkNoTarget) ? html`
                                <div style="font-size: 12px; color: var(--text-muted);">복사할 다른 태그가 없습니다.</div>
                              ` : html`
                                <div style="display: flex; gap: 7px; flex-wrap: wrap;">
                                  ${(r.bulkScopes || []).map((s) => html`<div onClick=${s.onClick} style=${s.style}>${s.label}</div>`)}
                                </div>
                              `}
                              ${/* 안내문은 버튼 위 별도 줄(읽고 나서 누르는 순서) */ ''}
                              <div style="margin-top: 16px; padding-top: 13px; border-top: 1px solid var(--border-light);">
                                <div style="font-size: 11.5px; color: var(--text-muted); line-height: 1.6;">${r.bulkNote}</div>
                                <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 13px;">
                                  <button onClick=${r.onBulkApply} style=${r.bulkApplyStyle}>${r.bulkApplyLabel}</button>
                                  <button onClick=${r.onBulkCancel} style="height: 30px; padding: 0 4px; border-radius: 6px; border: none; background: transparent; color: var(--text-muted); font-size: 12px; font-weight: 500; cursor: pointer;">취소</button>
                                </div>
                              </div>
                            `}
                          </td>
                        </tr>
                      ` : null}
                      ${(r.adv) ? html`
                        <tr style="border-bottom: 1px solid var(--border-light); background: var(--bg-elevated);">
                          <td colspan="6" style="padding: 14px 16px;">
                            <div style="display: flex; flex-wrap: wrap; gap: 24px;">
                              <div>
                                <div data-tip="RPM과 베어링 형상으로 계산한 이론값입니다. 스펙트럼이나 포락선에서 이 주파수에 피크가 서면 해당 부위의 결함을 의심합니다. 각 칩에 마우스를 올리면 항목별 설명이 나옵니다." style="font-size: 10px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px; cursor: help; display: inline-flex; align-items: center; gap: 4px;">결함 주파수 <span style="font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--text-muted);">Hz · 자동 계산</span><span class="codicon codicon-question" style="font-size: 10px; color: var(--text-muted);"></span></div>
                                <div style="display: flex; gap: 7px; flex-wrap: wrap;">
                                  ${(r.freqChips || []).map((c) => html`
                                    <div data-tip=${c.tip || ''} style="display: flex; flex-direction: column; gap: 3px; padding: 6px 12px; border-radius: 6px; background: var(--bg-primary); border: 1px solid var(--border-light); min-width: 52px;${c.tip ? ' cursor: help;' : ''}">
                                      <span style="font-size: 9px; font-weight: 700; letter-spacing: .3px; color: var(--text-muted); white-space: nowrap;">${c.label}</span>
                                      <span style="font-size: 14px; font-weight: 600; color: var(--text-primary); font-family: var(--font-mono);">${c.val}</span>
                                    </div>
                                  `)}
                                </div>
                              </div>
                              ${(r.isCatalog) ? html`
                                <div>
                                  <div style="font-size: 10px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px;">베어링 형상 <span style="font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--text-muted);">· ${r.bModel} 자동</span></div>
                                  <div style="display: flex; gap: 7px; flex-wrap: wrap;">
                                    ${(r.geoCells || []).map((g) => html`
                                      <div data-tip=${helpTip[g.k] || ''} style="display: flex; flex-direction: column; gap: 3px; padding: 6px 12px; border-radius: 6px; background: var(--bg-primary); border: 1px solid var(--border-light); cursor: help;">
                                        <span style="font-size: 9px; font-weight: 700; letter-spacing: .3px; color: var(--text-muted); white-space: nowrap;">${g.k}</span>
                                        <span style="font-size: 14px; font-weight: 600; color: var(--text-primary); font-family: var(--font-mono);">${g.v}</span>
                                      </div>
                                    `)}
                                  </div>
                                </div>
                              ` : null}
                            </div>
                            ${(r.isSleeve) ? html`
                              <div style="font-size: 12px; color: var(--text-muted); margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-light);">저널(sleeve) 베어링 — 구름요소가 없어 BPFO/BPFI/BSF/FTF가 정의되지 않습니다. 1×·2× 회전주파수 기준으로만 진단합니다.</div>
                            ` : null}
                            <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border-light);">
                              <div style="font-size: 10px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 10px;">계측·구동 <span style="font-weight: 500; text-transform: none; letter-spacing: 0;">· 선택 입력 — 모르면 비워두세요(<span class="codicon codicon-question" style="font-size: 10px;"></span> 에 마우스를 올리면 설명)</span></div>
                              <div style="display: flex; align-items: center; gap: 18px; flex-wrap: wrap;">
                                <label data-tip=${helpTip['마운팅 방식']} style="display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-secondary); cursor: help;">마운팅<span class="codicon codicon-question" style="font-size: 10px; color: var(--text-muted); margin-right: 2px;"></span>
                                  <select value=${r.mMount} onChange=${r.onMount} style="height: 28px; padding: 0 6px; border-radius: 5px; border: 1px solid ${r.mountUnset ? '#d99a2b' : 'var(--border-medium)'}; background: var(--bg-primary); color: var(--text-primary); font-size: 12px;">${(r.mountOptions || []).map((o) => html`<option value=${o.v}>${o.l}</option>`)}</select>
                                </label>
                                <label data-tip=${helpTip['구동방식']} style="display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-secondary); cursor: help;">구동<span class="codicon codicon-question" style="font-size: 10px; color: var(--text-muted); margin-right: 2px;"></span>
                                  <select value=${r.mDrive} onChange=${r.onDrive} style="height: 28px; padding: 0 6px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-primary); color: var(--text-primary); font-size: 12px;">${(r.driveOptions || []).map((o) => html`<option value=${o.v}>${o.l}</option>`)}</select>
                                </label>
                                <label data-tip=${helpTip['날개수 · 잇수']} style="display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-secondary); cursor: help;">${r.isGear ? '잇수' : '날개수'}<span class="codicon codicon-question" style="font-size: 10px; color: var(--text-muted); margin-right: 2px;"></span>
                                  <input value=${r.mVanes} onChange=${r.onVanes} placeholder="선택" style="height: 28px; width: 62px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-primary); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);" />
                                </label>
                                ${(r.vaneNote) ? html`<span data-tip="날개수 × 회전주파수로 계산한 베인 통과 주파수입니다. 스펙트럼에서 이 성분이 크면 유동 이상이나 간극 문제를 의심합니다." style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); cursor: help;">${r.vaneNote}</span>` : null}
                              </div>
                              ${(r.isBelt) ? html`
                                <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 10px; padding-left: 12px; border-left: 2px solid var(--border-medium);">
                                  <span data-tip=${helpTip['벨트 제원']} style="font-size: 11px; font-weight: 700; color: var(--text-tertiary); cursor: help; display: inline-flex; align-items: center; gap: 4px;">벨트 제원<span class="codicon codicon-question" style="font-size: 10px; color: var(--text-muted);"></span></span>
                                  <label data-tip=${helpTip['센서 위치']} style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: help;">센서 위치<span class="codicon codicon-question" style="font-size: 10px; color: var(--text-muted);"></span>
                                    <select value=${r.sensorPos} onChange=${r.onSensorPos} style="height: 28px; padding: 0 6px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-primary); color: var(--text-primary); font-size: 12px;"><option value="motor">모터측</option><option value="driven">종동측</option></select></label>
                                  <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary);">구동 풀리경 D1(mm)<input value=${r.mBeltD1} onChange=${r.onBeltD1} style="height: 28px; width: 62px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-primary); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);" /></label>
                                  <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary);">종동 풀리경 D2(mm)<input value=${r.mBeltD2} onChange=${r.onBeltD2} style="height: 28px; width: 62px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-primary); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);" /></label>
                                  <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary);">벨트길이(mm)<input value=${r.mBeltLen} onChange=${r.onBeltLen} placeholder="선택" style="height: 28px; width: 62px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-primary); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);" /></label>
                                  ${(r.isDriven) ? html`<label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary);">종동축 회전수(rpm)<input value=${r.mBeltRpm} onChange=${r.onBeltRpm} placeholder=${r.beltRpmPh} style="height: 28px; width: 130px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-primary); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);" /></label>` : null}
                                  ${(r.beltRatio) ? html`<span data-tip=${r.isDriven ? '결함 패턴·결함 주파수·대역이 이 회전수로 계산됩니다. 종동축 회전수 칸이 비어 있으면 모터 RPM × D1 ÷ D2로 환산합니다.' : '풀리비(D1÷D2)로 계산한 벨트 반대쪽 축의 회전주파수입니다. 스펙트럼의 비동기 성분이 이 값과 일치하면 종동축에서 온 진동으로 귀속됩니다.'} style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); cursor: help;">${r.beltRatio}</span>` : null}
                                </div>
                              ` : null}
                              <div style="font-size: 11.5px; color: ${r.mountUnset ? '#d99a2b' : 'var(--text-muted)'}; margin-top: 10px; line-height: 1.6;">${r.mountNote}</div>
                            </div>
                            ${(r.isCustom) ? html`
                              ${(r.retiredNote) ? html`<div style="font-size: 11.5px; color: #d99a2b; line-height: 1.6; margin-bottom: 8px;">${r.retiredNote}</div>` : null}
                              <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
                                <span data-tip="목록에 없는 베어링의 형상값을 직접 넣습니다. 네 값 모두 제조사 카탈로그의 형상 제원 표에 있습니다." style="font-size: 11px; font-weight: 700; color: var(--text-tertiary); cursor: help; display: inline-flex; align-items: center; gap: 4px;">직접 입력<span class="codicon codicon-question" style="font-size: 10px; color: var(--text-muted);"></span></span>
                                <label data-tip=${helpTip['품번']} style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: help;">품번<input value=${r.bName} onChange=${r.onGeoName} data-geo-name=${r.id} maxlength="40" placeholder="예: SKF 22218 E" style="height: 28px; width: 150px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-primary); color: var(--text-primary); font-size: 12px;" /></label>
                                <label data-tip=${helpTip['볼 수 n']} style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: help;">볼 수 n<input value=${r.bN} onChange=${r.onGeoN} style="height: 28px; width: 52px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-primary); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);" /></label>
                                <label data-tip=${helpTip['볼경 Bd']} style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: help;">볼경 Bd(mm)<input value=${r.bBd} onChange=${r.onGeoBd} style="height: 28px; width: 60px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-primary); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);" /></label>
                                <label data-tip=${helpTip['피치경 Pd']} style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: help;">피치경 Pd(mm)<input value=${r.bPd} onChange=${r.onGeoPd} style="height: 28px; width: 60px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-primary); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);" /></label>
                                <label data-tip=${helpTip['접촉각 φ']} style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: help;">접촉각 φ(°)<input value=${r.bPhi} onChange=${r.onGeoPhi} style="height: 28px; width: 52px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-primary); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);" /></label>
                              </div>
                            ` : null}
                          </td>
                        </tr>
                      ` : null}
                    `)}
                  </tbody>
                </table>
              </div>
              ${(equipFilterEmpty) ? html`
                <div style="padding: 20px 10px; text-align: center;">
                  <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">조건에 맞는 태그가 없습니다</div>
                  <button onClick=${onEquipFilterAll} style="height: 28px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-secondary); font-size: 11px; font-weight: 600; cursor: pointer;">전체 보기</button>
                </div>
              ` : null}
            </div>
          ` : null}

          ${(secCriteria) ? html`
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 20px; margin-bottom: 16px;">
              <div style="font-size: 17px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">판정 기준</div>
              <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px; line-height: 1.7;">등급은 결함 패턴이 잡혀야 켜지고, 존 경계가 그 높이(주의·위험·심각)를 정합니다.</div>
              <ul style="margin: 0 0 18px; padding-left: 18px; font-size: 12px; color: var(--text-tertiary); line-height: 1.7; list-style: none;">
                <li style="position: relative;"><span style="position: absolute; left: -14px;">•</span><b style="color: var(--text-secondary);">절대 임계</b>(존 경계) — ISO 10816 머신 클래스로 정합니다. 등급의 높이를 가릅니다.</li>
                <li style="position: relative;"><span style="position: absolute; left: -14px;">•</span><b style="color: var(--text-secondary);">상대 기준</b>(베이스라인, 아래) — 설비별 정상 상태를 학습해 평소 대비 변화를 표시합니다. 등급·알림에는 쓰이지 않습니다.</li>
              </ul>
              <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 8px;">머신 클래스</label>
              <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                ${(mcOptions || []).map((m) => html`<div onClick=${m.onClick} style=${m.style}>${m.label}</div>`)}
              </div>
              <div style="display: flex; gap: 10px; padding: 12px 14px; border-radius: 8px; background: var(--bg-elevated); border: 1px solid var(--border-light); margin-bottom: 14px;">
                <span class="codicon codicon-info" style="font-size: 16px; color: var(--primary-base); margin-top: 1px;"></span>
                <div>
                  <div style="font-size: 13px; font-weight: 600; color: var(--text-primary);">${mcDescTitle}</div>
                  <div style="font-size: 12px; color: var(--text-secondary); margin-top: 3px; line-height: 1.5;">${mcDescBody}</div>
                  <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">ISO 10816-3 기준 · 머신 클래스에 따라 진동 심각도 존(A 양호 → D 심각)의 경계값이 달라집니다.</div>
                </div>
              </div>
              <div style="border: 1px solid var(--border-light); border-radius: 8px; padding: 14px 16px;">
                <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">존 경계 미리보기 (mm/s RMS · 선택 클래스 기준)</div>
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
                  ${(mcZones || []).map((z) => html`
                    <div><div style=${z.barStyle}></div><div style="margin-top: 6px; font-size: 12px; font-weight: 600; color: var(--text-secondary);">${z.ko}</div><div style="font-size: 12px; color: var(--text-muted); font-family: var(--font-mono);">${z.range}</div></div>
                  `)}
                </div>
              </div>
            </div>
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 20px; margin-bottom: 16px;">
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                <label style="font-size: 12px; font-weight: 600; color: var(--text-tertiary);">클래스별 임계값</label>
                <button onClick=${onSaveSettings} style="margin-left: auto; height: 28px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-secondary); font-size: 11px; font-weight: 500; cursor: pointer;">저장</button>
                <button data-tip=${helpTip['임계 초기화']} onClick=${onResetThresh} style="height: 28px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-secondary); font-size: 11px; font-weight: 500; cursor: pointer;">기본값으로 초기화</button>
              </div>
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px;">각 태그는 자신의 Class(속도 mm/s) 또는 단위(g·μm) 행 값을 상속합니다. 속도(mm/s)는 <b style="color: var(--text-secondary);">ISO 10816 기준값</b>, 가속도(g)·변위(μm)는 <b style="color: var(--text-secondary);">일반 참고 기본값</b>이며 모두 직접 수정할 수 있습니다. g·μm 행은 추이 기준선·기간 통계 표시에만 쓰이고, 등급은 속도로 환산해 Class 행으로 매깁니다.</div>
              <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; min-width: 560px;">
                  <thead><tr>
                    <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); padding: 7px 8px; border-bottom: 1px solid var(--border-default); font-size: 11px; white-space: nowrap;">구분</th>
                    <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); padding: 7px 8px; border-bottom: 1px solid var(--border-default); font-size: 11px; white-space: nowrap;"><span data-tip=${helpTip['A/B']} style="cursor: help; display: inline-flex; align-items: center; gap: 4px;">양호↔주의 (A/B)<span class="codicon codicon-question" style="font-size: 10px; color: var(--text-muted);"></span></span></th>
                    <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); padding: 7px 8px; border-bottom: 1px solid var(--border-default); font-size: 11px; white-space: nowrap;"><span data-tip=${helpTip['B/C']} style="cursor: help; display: inline-flex; align-items: center; gap: 4px;">주의↔위험 (B/C)<span class="codicon codicon-question" style="font-size: 10px; color: var(--text-muted);"></span></span></th>
                    <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); padding: 7px 8px; border-bottom: 1px solid var(--border-default); font-size: 11px; white-space: nowrap;"><span data-tip=${helpTip['C/D']} style="cursor: help; display: inline-flex; align-items: center; gap: 4px;">위험↔심각 (C/D)<span class="codicon codicon-question" style="font-size: 10px; color: var(--text-muted);"></span></span></th>
                    <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); padding: 7px 8px; border-bottom: 1px solid var(--border-default); font-size: 11px;">단위</th>
                  </tr></thead>
                  <tbody>
                    ${(threshRows || []).map((r) => html`
                      <tr style="border-bottom: 1px solid var(--border-light);">
                        <td style="padding: 6px 8px; color: var(--text-primary); font-weight: 500; white-space: nowrap;">${r.label}</td>
                        <td style="padding: 6px 8px;"><input value=${r.v0} onChange=${r.on0} style="height: 28px; width: 74px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);" /></td>
                        <td style="padding: 6px 8px;"><input value=${r.v1} onChange=${r.on1} style="height: 28px; width: 74px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);" /></td>
                        <td style="padding: 6px 8px;"><input value=${r.v2} onChange=${r.on2} style="height: 28px; width: 74px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);" /></td>
                        <td style="padding: 6px 8px; color: var(--text-muted); font-family: var(--font-mono);">${r.unit}</td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              </div>
            </div>
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 20px; margin-bottom: 16px;">
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                <div style="font-size: 17px; font-weight: 600; color: var(--text-primary);">베이스라인 학습</div>
                <button onClick=${onBlLearnAll} style="margin-left: auto; height: 28px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-secondary); font-size: 11px; font-weight: 600; cursor: pointer;">전체 학습</button>
              </div>
              <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px; line-height: 1.7;">정상 운전 구간 RMS의 중심(μ)과 평소 변동(σ)을 학습해 한계(μ+kσ) 초과 시 카드와 근거표에 <b style="color: var(--text-secondary);">베이스라인 이탈</b>로 표시합니다. 등급·알림에는 쓰이지 않습니다.</div>
              <ul style="margin: -6px 0 14px; padding-left: 18px; font-size: 12px; color: var(--text-tertiary); line-height: 1.7; list-style: none;">
                <li style="position: relative;"><span style="position: absolute; left: -14px;">•</span>절대값이 양호 존이라도 평소 대비 급증을 알아볼 수 있습니다.</li>
                <li style="position: relative;"><span style="position: absolute; left: -14px;">•</span>추정은 스파이크에 흔들리지 않는 중앙값 방식이고, 정지·기동 구간은 학습에서 자동 제외됩니다.</li>
                <li style="position: relative;"><span style="position: absolute; left: -14px;">•</span>학습은 선택 사항이며, 등급 판정(결함 패턴·존 경계)은 학습과 무관하게 항상 동작합니다.</li>
              </ul>
              ${(monBlNotice) ? html`
                <div style="display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-radius: 8px; background: rgba(217,154,43,0.12); border: 1px solid rgba(217,154,43,0.35); margin-bottom: 14px;">
                  <span class="codicon codicon-warning" style="font-size: 15px; color: #d99a2b; flex-shrink: 0;"></span>
                  <span style="font-size: 12px; color: var(--text-secondary);">미학습 태그 <b style="color: var(--text-primary);">${monBlUnlearned}개</b> — 등급 판정은 되지만 평소 대비 급증(베이스라인 이탈)은 표시되지 않습니다. 보려면 아래에서 학습하세요.</span>
                </div>
              ` : null}
              ${/* 오래된 기준 안내 — 자동 재학습 없음(진행 중 결함의 정상 흡수 방지), 좌측 판정 기준 배지에도 "재학습 N" 표시 */ ''}
              ${(blOldCnt > 0) ? html`
                <div style="display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-radius: 8px; background: rgba(217,154,43,0.12); border: 1px solid rgba(217,154,43,0.35); margin-bottom: 14px;">
                  <span class="codicon codicon-history" style="font-size: 15px; color: #d99a2b; flex-shrink: 0;"></span>
                  <span style="font-size: 12px; color: var(--text-secondary); line-height: 1.6;">학습한 지 한 달이 넘은 태그 <b style="color: var(--text-primary);">${blOldCnt}개</b> — 그 사이 정비나 운전 조건 변경이 있었다면 지금 기준은 정상을 대표하지 않습니다. 각 행의 <b style="color: var(--text-primary);">학습</b>으로 갱신하십시오.</span>
                </div>
              ` : null}
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                <label data-tip=${helpTip['정상 학습 기간']} style="font-size: 12px; font-weight: 600; color: var(--text-tertiary); cursor: help; display: inline-flex; align-items: center; gap: 4px;">정상 학습 기간<span class="codicon codicon-question" style="font-size: 10px; color: var(--text-muted);"></span></label>
                <select value=${blWin} onChange=${onBlWin} style="height: 30px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px;"><option value="1h">최근 1시간</option><option value="6h">최근 6시간</option><option value="24h">최근 24시간</option></select>
                <label data-tip=${helpTip['k (σ 배수)']} style="font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-left: 8px; cursor: help; display: inline-flex; align-items: center; gap: 4px;">k (σ 배수)<span class="codicon codicon-question" style="font-size: 10px; color: var(--text-muted);"></span></label>
                <input value=${blK} onChange=${onBlK} style="height: 30px; width: 64px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);" />
                <span style="font-size: 11px; color: var(--text-muted);">${blSampleText}</span>
              </div>
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px;">기간이 길수록 다양한 정상 운전 상태를 포함해 기준이 견고해집니다(대표성↑). 데이터가 그보다 짧으면 있는 만큼만 학습합니다. 표본은 판정과 같은 RMS 구간 단위로 묶어 판정 값과 기준이 같습니다.</div>
              <!-- 확인 대기 일괄 유지 — 초기화는 비가역이라 행별로만 -->
              ${(revPending > 0) ? html`
                <div style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; margin-bottom: 12px; border-radius: 6px; border: 1px solid var(--border-default); background: var(--bg-elevated);">
                  <span class="codicon codicon-history" style="font-size: 14px; color: var(--text-muted);"></span>
                  <span style="font-size: 12px; color: var(--text-secondary);">확인 대기 <b style="color: var(--text-primary);">${revPending}개</b> — 답할 때까지 이 태그들은 학습 기반 판정이 멈춰 있습니다</span>
                  <button onClick=${onKeepAllRevived} style="margin-left: auto; height: 26px; padding: 0 12px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-secondary); color: var(--text-primary); font-size: 11px; font-weight: 600; cursor: pointer;">모두 같은 설비 — 유지</button>
                </div>
              ` : null}
              ${(blEmpty) ? html`<div style="font-size: 12px; color: var(--text-muted); padding: 10px 0;">선택된 데이터 소스가 없습니다 — 데이터 소스에서 테이블을 먼저 선택하세요.</div>` : null}
              ${(blRows || []).map((r) => html`
                <div style="display: flex; align-items: center; gap: 12px; padding: 8px 4px; border-bottom: 1px solid var(--border-light);">
                  <span style="font-size: 13px; color: var(--text-primary); min-width: 180px;">${r.label}</span>
                  <span data-tip=${r.statusTip || ''} style="font-size: 11px; font-family: var(--font-mono); color: ${r.statusColor}; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;${r.statusTip ? ' cursor: help;' : ''}">${r.statusText}</span>
                  ${(r.ago) ? html`<span data-tip="이 기준을 학습한 시점입니다. 설비 정비나 운전 조건 변경 뒤의 기준은 정상을 대표하지 않으니 다시 학습하십시오." style="font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; white-space: nowrap; cursor: help; color: ${r.agoStale ? '#d99a2b' : 'var(--text-muted)'}; background: ${r.agoStale ? 'rgba(217,154,43,.12)' : 'var(--bg-elevated)'};">${r.ago}</span>` : null}
                  ${(r.revived) ? html`
                    <button onClick=${r.revActions.keep} style="height: 26px; padding: 0 12px; border-radius: 5px; border: 1px solid var(--border-medium); background: transparent; color: var(--text-secondary); font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap;">같은 설비 — 유지</button>
                    <button onClick=${r.revActions.reset} style="height: 26px; padding: 0 12px; border-radius: 5px; border: none; background: var(--primary-base); color: #fff; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap;">다른 설비 — 초기화</button>
                  ` : html`
                    <button onClick=${r.onLearn} style=${r.learnBtnStyle}>학습</button>
                    ${(r.hasBl) ? html`<button onClick=${r.onDel} style="height: 26px; padding: 0 10px; border-radius: 5px; border: 1px solid var(--border-medium); background: transparent; color: var(--text-muted); font-size: 11px; cursor: pointer;">삭제</button>` : null}
                  `}
                </div>
              `)}
            </div>
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 20px;">
              <div style="font-size: 17px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">대역 에너지 추세</div>
              <div style="font-size: 12px; color: var(--text-muted); line-height: 1.7;">전체 RMS로는 안 보이는 변화를 잡습니다 — 베어링 결함이 커져도 전체는 거의 안 움직이지만 해당 대역만 보면 몇 배로 뜁니다.</div>

              ${/* 구획은 소제목 + 윗선(다른 카드와 통일) — 추출 · 학습 · 채널 상태 순 */ ''}
              <div style="display: flex; align-items: center; gap: 10px; margin-top: 16px;">
                <span style="font-size: 13px; font-weight: 600; color: var(--text-primary);">대역·결함 패턴 추출</span>
                <div style="margin-left: auto;"><div style=${bandToggleStyle} onClick=${onBandToggle}><div style=${bandKnobStyle}></div></div></div>
              </div>
              ${(bandNoTargetWarn) ? html`<div style="font-size: 11px; color: var(--warning); margin-top: 10px; padding: 8px 11px; background: rgba(199,125,10,.1); border: 1px solid rgba(199,125,10,.3); border-radius: 6px; line-height: 1.6;">켜져 있지만 조건을 갖춘 태그가 없어 <b>추출이 돌지 않습니다</b> — ${bandNoTargetWarn}. 설비 정보에서 RPM을 입력하십시오.</div>` : null}
              <div id="band-iv" style="display: flex; align-items: center; gap: 10px; margin-top: 10px; scroll-margin-top: 80px;">
                <label data-tip=${helpTip['대역 추출 주기']} style="font-size: 12px; font-weight: 600; color: var(--text-tertiary); cursor: help; display: inline-flex; align-items: center; gap: 4px;">추출 주기<span class="codicon codicon-question" style="font-size: 10px; color: var(--text-muted);"></span></label>
                <select value=${bandInterval} onChange=${onBandIvPickDirect} style="height: 30px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px;">${(bandIvOptions || []).map((o) => html`<option value=${o.v} disabled=${!!o.disabled}>${o.l}</option>`)}</select>
                <span style="font-size: 11px; color: var(--text-muted); line-height: 1.6;">${bandIvHint || '주기가 짧을수록 표본이 빨리 쌓입니다'}</span>
              </div>

              <div style="display: flex; align-items: center; gap: 10px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border-light);"><span style="font-size: 13px; font-weight: 600; color: var(--text-primary);">정상 기준 학습</span></div>
              <div style="font-size: 11px; color: var(--text-muted); line-height: 1.7; margin-top: 8px;">정상 운전이 확실할 때 학습하십시오 — 결함이 진행 중이면 그 결함이 정상 기준이 됩니다.</div>
              <div style="display: flex; align-items: center; gap: 10px; margin-top: 12px;">
                <label data-tip=${helpTip['대역 학습 기간']} style="font-size: 12px; font-weight: 600; color: var(--text-tertiary); cursor: help; display: inline-flex; align-items: center; gap: 4px;">대역 학습 기간<span class="codicon codicon-question" style="font-size: 10px; color: var(--text-muted);"></span></label>
                <select value=${bandWin} onChange=${onBandWin} style="height: 30px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px;">${(bandWinOptions || []).map((o) => html`<option value=${o.v}>${o.l}</option>`)}</select>
                <span style="font-size: 11px; color: ${bandSampleWarn ? 'var(--warning)' : 'var(--text-muted)'}; line-height: 1.6;">${bandSampleText}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 10px; margin-top: 10px;">
                <span data-tip=${bandFillDesc} style="font-size: 12px; font-weight: 600; color: var(--text-tertiary); cursor: help;">과거 데이터 채우기</span>
                ${(bandFill) ? html`<button onClick=${onBandFillStop} style="height: 28px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--danger-border); background: transparent; color: var(--danger-text); font-size: 11px; font-weight: 600; cursor: pointer;">중지</button>`
                  : html`<button onClick=${onBandFill} disabled=${!bandOn} style=${bandFillBtnStyle}>채우기</button>`}
                <span style="font-size: 11px; color: var(--text-muted); line-height: 1.6;">${bandFillShort}</span>
                ${(bandFillSkipTip) ? html`<span data-tip=${bandFillSkipTip} style="font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; cursor: help; color: #d99a2b; background: rgba(217,154,43,.12); white-space: nowrap;">대상 ${bandFillTargets}</span>` : null}
              </div>
              ${(bandFill) ? html`
                <div style="margin-top: 10px;">
                  <div style="height: 6px; border-radius: 3px; background: var(--bg-elevated); overflow: hidden;"><div style=${bandFillBarStyle}></div></div>
                  <div style="display: flex; gap: 10px; margin-top: 6px; font-size: 11px; font-family: var(--font-mono); color: var(--text-muted);">
                    <span>${bandFill.done} / ${bandFill.total}</span>
                    <span>남은 시간 약 ${bandFillEta}</span>
                    <span style="margin-left: auto; color: ${bandFill.learnable ? 'var(--ok-text)' : 'var(--text-muted)'}; font-weight: 600;">${bandFill.learnable ? '학습 가능 ✓' : '학습 최소 표본 미달'}</span>
                  </div>
                </div>` : null}

              <div style="display: flex; align-items: center; gap: 10px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border-light);">
                <span style="font-size: 13px; font-weight: 600; color: var(--text-primary);">채널별 학습 상태</span>
                <span style="font-size: 11px; color: var(--text-muted);">학습됨 ${bandLearnedN}/${bandTotalN}</span>
                <button onClick=${onBandLearnAll} style="margin-left: auto; height: 28px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-secondary); font-size: 11px; font-weight: 600; cursor: pointer;">전체 학습</button>
              </div>
              ${(bandEmpty) ? html`<div style="font-size: 12px; color: var(--text-muted); padding: 6px 0;">선택된 데이터 소스가 없습니다.</div>` : null}
              ${(bandRows || []).map((r) => html`
                <div style="display: flex; align-items: center; gap: 12px; padding: 8px 4px; border-bottom: 1px solid var(--border-light);">
                  <span style="font-size: 12px; color: var(--text-secondary); min-width: 150px;">${r.label}</span>
                  ${(r.fill) ? html`<span data-tip=${r.fill.tip} style=${r.fill.style}>${r.fill.text}</span>` : null}
                  <span data-tip=${r.tip || ''} style="font-size: 11px; font-family: var(--font-mono); color: ${r.color}; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;${r.tip ? ' cursor: help;' : ''}">${r.statusText}</span>
                  ${(r.ago) ? html`<span data-tip="이 기준을 학습한 시점입니다. 설비 정비나 운전 조건 변경 뒤의 기준은 정상을 대표하지 않으니 다시 학습하십시오." style="font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; white-space: nowrap; cursor: help; color: ${r.agoStale ? '#d99a2b' : 'var(--text-muted)'}; background: ${r.agoStale ? 'rgba(217,154,43,.12)' : 'var(--bg-elevated)'};">${r.ago}</span>` : null}
                  <button onClick=${r.onLearn} style=${r.learnBtnStyle}>학습</button>
                  ${(r.hasBl) ? html`<button onClick=${r.onDel} title="대역 베이스라인 삭제" style="height: 26px; width: 26px; border-radius: 5px; border: 1px solid var(--border-medium); background: transparent; color: var(--text-muted); cursor: pointer; flex-shrink: 0;"><span class="codicon codicon-trash" style="font-size: 12px;"></span></button>` : null}
                </div>
              `)}
            </div>
          ` : null}

          ${(secMonitor) ? html`
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 20px;">
              <div style="font-size: 17px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">알람 설정</div>
              <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 20px;">주기적으로 설비를 판정해 등급이 바뀌거나 신호 두절·계측 이상이 생기면 이벤트를 기록합니다. 판정 기준(존 경계·베이스라인·추출 주기)은 <b style="color: var(--text-secondary);">판정 기준</b> 탭에서 설정하며, 여기서는 감시 방식·판정 주기와 알림을 설정합니다. 이벤트 이력은 DB에 저장되어 다시 열 때 이어집니다</div>
              <div style="display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border-light);">
                <div style=${monToggleStyle} onClick=${onMonToggle}><div style=${monKnobStyle}></div></div>
                <span style="font-size: 13px; color: var(--text-primary); font-weight: 500;">알람 활성화</span>
              </div>
              <div style="margin-top: 18px;">
                <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 8px;">감시 방식</label>
                <div style="display: flex; gap: 10px;">
                  ${(monModeOptions || []).map((o) => html`
                    <button onClick=${o.onClick} style=${o.style}>
                      <div style=${o.titleStyle}>${o.label}</div>
                      <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">${o.desc}</div>
                    </button>
                  `)}
                </div>
                ${(serverMon) ? html`<div style="font-size: 11px; color: var(--text-muted); margin-top: 8px; line-height: 1.6;">저장하면 Neo 타이머가 <b style="color: var(--text-secondary);">평가 주기</b>마다 선택 태그를 판정합니다. 앱을 닫아도 이벤트가 쌓이며, 이 모드에서 앱 화면은 표시만 하고 판정은 서버가 담당합니다.</div>` : null}
              </div>
              ${/* 두 시간값의 관계는 문장 안에 표시, 부하·경고도 같은 상자 */ ''}
              <div style="margin-top: 18px; padding: 14px 16px; border-radius: 8px; background: var(--bg-secondary);">
                <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px;">
                  <span style="font-size: 13px; color: var(--text-secondary);">직전</span>
                  <select value=${evalWindowSel} onChange=${onEvalWindow} style="height: 32px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px; font-weight: 600;">${(evalWindowOptions || []).map((o) => html`<option value=${o.v} disabled=${o.disabled}>${o.l}${o.disabled ? ' (주기보다 짧음)' : ''}</option>`)}</select>
                  ${(evalWinCustom) ? html`<input type="number" min="1" step="1" value=${evalWinCustomMin} onInput=${onEvalWinMin} style="height: 32px; width: 72px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px; font-weight: 600; font-family: var(--font-mono);" /><span style="font-size: 13px; color: var(--text-secondary);">분</span>` : null}
                  <span style="font-size: 13px; color: var(--text-secondary);">구간의 데이터를</span>
                  <select value=${monitorInterval} onChange=${onMonitorInterval} style="height: 32px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px; font-weight: 600;"><option value="1s">1초</option><option value="3s">3초</option><option value="5s">5초</option><option value="10s">10초</option><option value="30s">30초</option><option value="1m">1분</option></select>
                  <span style="font-size: 13px; color: var(--text-secondary);">마다 판정</span>
                  <span data-tip=${helpTip['RMS 구간']} class="codicon codicon-question" style="font-size: 11px; color: var(--text-muted); cursor: help;"></span>
                </div>
                ${(evalLoadWarn) ? html`<div style="font-size: 11px; color: var(--warning); margin-top: 10px; font-weight: 600;">${evalLoadText}</div>` : null}
                ${(evalWinBad) ? html`<div style="font-size: 11px; color: var(--warning); margin-top: 8px; font-weight: 600;">RMS 구간이 판정 주기보다 짧습니다 — 그 사이 데이터가 판정에 들어가지 않습니다.</div>` : null}
              </div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border-light); line-height: 1.7;">구간이 길면 짧은 진동이 하나의 상태로 합쳐집니다. 이 값은 <b>운전/정지 · 신호 두절 · 계측 이상 · 평소 대비</b>에 쓰이고, <b>등급은 아래 패턴·대역 추출 주기</b>에서 나옵니다.</div>
            </div>
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 20px; margin-top: 16px;">
              <div style="font-size: 17px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">알림</div>
              <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 20px;">알람을 언제 낼지와 어디로 보낼지를 설정합니다</div>
              ${/* 확정 흐름 회차별 표 — 위에 웹훅 발송 조건 요약, 악화·복귀 두 묶음, 왼쪽 레일로 에피소드 흐름 표시 */ ''}
              <div style="background: var(--bg-inset); border-radius: 7px; padding: 18px 20px 15px;">
                <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 0 0 16px;"><span style="font-size: 13px; color: var(--text-primary); line-height: 1.6;"><b>${confirmIvKo}</b>마다 판정하고, <b>등급이 바뀐 뒤 다음 판정에서도 같으면</b> 알림이 갑니다 <span style="color: var(--text-muted); font-size: 12px;">(최대 ${confirmSumKo})</span></span><button onClick=${onGoBandIv} style="border: 1px solid var(--border-medium); background: var(--bg-secondary); border-radius: 5px; padding: 4px 10px; font: inherit; font-size: 11px; color: var(--text-secondary); cursor: pointer; white-space: nowrap;">주기 변경</button></div>
                <div style="display: grid; grid-template-columns: 18px 62px 1fr 84px 84px; gap: 0 10px; align-items: center; font-size: 12.5px;">
                  <span></span>
                  <span style="font-size: 11px; color: var(--text-muted); padding-bottom: 8px;">회차</span>
                  <span style="font-size: 11px; color: var(--text-muted); padding-bottom: 8px;">동작</span>
                  <span style="font-size: 11px; color: var(--text-muted); padding-bottom: 8px; text-align: right;">등급 표시</span>
                  <span style="font-size: 11px; color: var(--text-muted); padding-bottom: 8px; text-align: right;">웹훅 알림</span>
                  ${(confirmSteps || []).map((s) => (s.head ? html`
                    ${/* 묶음 머리 — 레일을 끊어 두 구간 분리 */ ''}
                    <span></span>
                    <span style="grid-column: 2 / -1; display: flex; align-items: center; gap: 10px; padding: 14px 0 8px;">
                      <span style="font-size: 11.5px; font-weight: 700; color: ${s.color}; white-space: nowrap;">${s.head}</span>
                      <span style="flex: 1; height: 1px; background: var(--border-light);"></span>
                    </span>
                  ` : html`
                    ${/* 레일 — 점 위아래 선으로 에피소드 흐름 표시(묶음 끝에서 끊음) */ ''}
                    <span style="align-self: stretch; position: relative; display: flex; justify-content: center; align-items: center; min-height: 42px;">
                      ${(!s.first) ? html`<span style="position: absolute; top: 0; height: 50%; width: 2px; background: var(--border-medium); border-radius: 1px;"></span>` : null}
                      ${(!s.last) ? html`<span style="position: absolute; bottom: 0; height: 50%; width: 2px; background: var(--border-medium); border-radius: 1px;"></span>` : null}
                      <span style="position: relative; width: 10px; height: 10px; border-radius: 50%; background: ${s.dot ? s.color : 'var(--bg-inset)'}; border: 2px solid ${s.dot ? s.color : 'var(--border-medium)'};"></span>
                    </span>
                    <span style="color: ${s.dot ? 'var(--text-primary)' : 'var(--text-muted)'}; font-weight: ${s.dot ? '700' : '400'}; padding: 14px 0; white-space: nowrap; border-bottom: 1px solid ${s.last ? 'transparent' : 'var(--border-light)'};">${s.when}</span>
                    <span style="color: ${s.dot ? 'var(--text-primary)' : 'var(--text-secondary)'}; font-weight: ${s.dot ? '600' : '400'}; padding: 14px 0; border-bottom: 1px solid ${s.last ? 'transparent' : 'var(--border-light)'};">${s.what}</span>
                    <span style="font-size: 12px; font-weight: ${s.dot ? '700' : '400'}; color: ${s.dot ? s.color : 'var(--text-muted)'}; padding: 14px 0; text-align: right; white-space: nowrap; border-bottom: 1px solid ${s.last ? 'transparent' : 'var(--border-light)'};">${s.chip}</span>
                    <span style="font-size: 12px; font-weight: 600; padding: 14px 0; text-align: right; white-space: nowrap; color: ${s.sent ? 'var(--primary-light)' : 'var(--text-muted)'}; border-bottom: 1px solid ${s.last ? 'transparent' : 'var(--border-light)'};">${s.sent ? '발송' : '보내지 않음'}</span>
                  `))}
                </div>
              </div>
              <div style="border-top: 1px solid var(--border-light); margin: 20px 0;"></div>
              <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 12px;">알림 채널</label>
              <div style="display: flex; flex-direction: column; gap: 14px; margin-bottom: 24px;">
                ${(notifChannels || []).map((c) => html`
                  <div style="display: flex; align-items: flex-start; gap: 14px;">
                    <div style=${c.toggleStyle} onClick=${c.onToggle}><div style=${c.knobStyle}></div></div>
                    <span style="width: 54px; font-size: 13px; font-weight: 600; color: var(--text-primary); flex-shrink: 0; padding-top: 6px;">${c.label}</span>
                    <div style="flex: 1;">
                      <div style="display: flex; gap: 8px;">
                        <input value=${c.value} onChange=${c.onInput} placeholder=${c.ph} style=${c.inputStyle} />
                        <button onClick=${c.onTest} style=${c.testBtnStyle}>${c.testLabel}</button>
                      </div>
                      <div style="font-size: 10px; color: var(--text-muted); margin-top: 3px;">${c.hint}</div>
                      ${(c.testShow) ? html`<div style=${c.testMsgStyle}>${c.testMsg}</div>` : null}
                    </div>
                  </div>
                `)}
              </div>
              <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 4px;">심각도별 알림</label>
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px;">심각도마다 알림 여부와, 비정상이 이어질 때 다시 알릴 주기를 정합니다. 재알림 이벤트는 발송과 별개로 이력에는 항상 남습니다</div>
              ${(routeNoneWarn) ? html`<div style="font-size: 11px; color: var(--warning); margin-bottom: 10px; padding: 8px 11px; background: rgba(199,125,10,.1); border: 1px solid rgba(199,125,10,.3); border-radius: 6px;">채널은 켜져 있지만 모든 심각도가 '알림 안 함'이라 <b>알림이 발송되지 않습니다</b> — 아래에서 받을 심각도를 '즉시'로 바꾸세요</div>` : null}
              <table style="width: 100%; border-collapse: collapse; font-size: 12px; max-width: 480px;">
                <thead><tr>
                  <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); padding: 7px 8px; border-bottom: 1px solid var(--border-default); font-size: 11px;">심각도</th>
                  <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); padding: 7px 8px; border-bottom: 1px solid var(--border-default); font-size: 11px;">알림 방식</th>
                  <th style="text-align: left; font-weight: 600; color: var(--text-tertiary); padding: 7px 8px; border-bottom: 1px solid var(--border-default); font-size: 11px;">지속 시 재알림</th>
                </tr></thead>
                <tbody>
                  ${(alertRows || []).map((r) => html`
                    <tr style="border-bottom: 1px solid var(--border-light);">
                      <td style="padding: 8px; white-space: nowrap;"><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${r.color}; margin-right: 8px; vertical-align: middle;"></span><span style="font-weight: 500; color: var(--text-primary);">${r.ko}</span></td>
                      <td style="padding: 8px;"><select value=${r.timing} onChange=${r.onTiming} style="height: 30px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; min-width: 110px;">${(routeTimings || []).map((t) => html`<option value=${t}>${t}</option>`)}</select></td>
                      <td style="padding: 8px;">${r.renoNA ? html`<span style="font-size: 12px; color: var(--text-muted);" title="상태가 유지되는 동안은 이벤트가 나지 않으므로 재알림할 대상이 없습니다">—</span>` : html`<select value=${r.reno} onChange=${r.onReno} style="height: 30px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; min-width: 110px;">${(renotifyOptions || []).map((o) => html`<option value=${o.v}>${o.l}</option>`)}</select>`}</td>
                    </tr>
                  `)}
                </tbody>
              </table>
            </div>
          ` : null}

          ${(secLlm) ? html`
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 20px;">
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                <div style="font-size: 17px; font-weight: 600; color: var(--text-primary);">LLM 연동</div>
                <span style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: ${llmStatusColor}; margin-left: auto;"><span style="width: 7px; height: 7px; border-radius: 50%; background: ${llmStatusColor};"></span>${llmStatusText}</span>
              </div>
              <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 18px;">리포트 소견과 상세분석의 LLM 심층 소견 생성에 사용됩니다</div>
              <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 8px;">프로바이더</label>
              <div style="display: flex; gap: 8px; margin-bottom: 16px;">${(llmProviders || []).map((p) => html`<div onClick=${p.onClick} style=${p.style}>${p.label}</div>`)}</div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
                <div><label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 7px;">API 키</label><input type="password" value=${llmApiKey} onChange=${onLlmKey} placeholder="API Key" style="height: 34px; width: 100%; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px; font-family: var(--font-mono);" /></div>
                <div><label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 7px;">모델</label><input value=${llmModel} onChange=${onLlmModel} placeholder=${llmModelPh} style="height: 34px; width: 100%; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px; font-family: var(--font-mono);" /></div>
              </div>
              ${(isOllama) ? html`<div style="margin-bottom: 16px;"><label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 7px;">Ollama URL</label><input value=${ollamaUrl} onChange=${onOllamaUrl} style="height: 34px; width: 100%; max-width: 340px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px; font-family: var(--font-mono);" /></div>` : null}
              <div style="display: flex; align-items: center; gap: 12px;">
                <button onClick=${onTestLLM} style="height: 36px; padding: 0 16px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 7px;">${(llmTesting) ? html`<span class="codicon codicon-loading" style="font-size: 14px; animation: vspin .8s linear infinite;"></span>` : null}연결 테스트</button>
                ${(llmTestShow) ? html`<span style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: ${llmTestColor};"><span class="codicon codicon-${llmTestIcon}" style="font-size: 14px;"></span>${llmTestMsg}</span>` : null}
              </div>
              <div style="margin-top: 16px; padding: 12px 14px; border-radius: 8px; background: var(--bg-elevated); border: 1px solid var(--border-light); font-size: 12px; color: var(--text-muted); line-height: 1.6;"><b style="color: var(--text-secondary);">미설정 시:</b> 리포트 소견·상세분석 LLM 소견 기능은 비활성화되며, 지표 기반 분석은 정상 동작합니다.</div>
            </div>
          ` : null}

          ${(secData) ? html`
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; padding: 20px;">
              <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 4px;">
                <div style="font-size: 17px; font-weight: 600; color: var(--text-primary);">데이터 관리</div>
                <button onClick=${onUsageRefresh} title="현황 다시 읽기" style="margin-left: auto; height: 28px; padding: 0 11px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-secondary); font-size: 11px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;"><span class="codicon codicon-refresh" style="font-size: 12px;"></span>새로고침</button>
              </div>
              <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 18px;">이 패키지가 만든 테이블입니다. 삭제한 데이터는 되돌릴 수 없어, 지울 양을 먼저 확인한 뒤 실행합니다.</div>

              ${(usageBusy) ? html`<div style="padding: 30px 10px; text-align: center; font-size: 12px; color: var(--text-muted);">현황을 읽는 중…</div>` : null}
              ${(!usageBusy && !usageReady) ? html`<div style="padding: 30px 10px; text-align: center; font-size: 12px; color: var(--text-muted);">현황을 읽지 못했습니다 — 새로고침을 눌러보세요.</div>` : null}

              ${(dataRows || []).map((r) => html`
                <div style="display: grid; grid-template-columns: 1fr auto; gap: 18px; align-items: start; padding: 17px 0; border-top: 1px solid var(--border-light);">
                  <div style="min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 9px; flex-wrap: wrap;">
                      <span style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${r.name}</span>
                      <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">${r.table}</span>
                      <!-- 표 유형 알약 — 유형별 삭제 범위 구분용 -->
                      <span style="display: inline-flex; align-items: center; gap: 5px; font-size: 9.5px; font-weight: 700; letter-spacing: .04em; padding: 2px 8px; border-radius: 10px; color: ${r.kind === 'TAG' ? 'var(--primary-light)' : '#d99a2b'}; background: ${r.kind === 'TAG' ? 'rgba(0,108,210,.14)' : 'rgba(217,154,43,.14)'};">
                        <span style="width: 5px; height: 5px; border-radius: 50%; background: currentColor;"></span>${r.kind}
                      </span>
                    </div>
                    <div style="font-size: 12.5px; margin-top: 6px; font-variant-numeric: tabular-nums; color: var(--text-secondary);">${r.stat}</div>
                    <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 6px; line-height: 1.55; max-width: 64ch;">${r.note}</div>
                  </div>
                  ${(r.act) ? html`
                    <div style="display: flex; flex-direction: column; align-items: stretch; gap: 5px; min-width: 168px;">
                      <button onClick=${r.act.onClick} style="height: 34px; padding: 0 14px; border-radius: 6px; font-size: 12.5px; font-weight: 700; white-space: nowrap; font-family: inherit; cursor: pointer; border: ${r.act.danger ? 'none' : '1px solid var(--border-medium)'}; background: ${r.act.danger ? '#e5484d' : 'var(--bg-elevated)'}; color: ${r.act.danger ? '#fff' : 'var(--text-secondary)'};">${r.act.label}</button>
                      <div style="font-size: 10.5px; color: var(--text-muted); text-align: right;">${r.act.sub}</div>
                      <!-- 태그별 정리 — 감시 목록 밖 태그 있을 때만 -->
                      ${(r.act2) ? html`<button onClick=${r.act2.onClick} style="height: 30px; padding: 0 12px; border-radius: 6px; font-size: 12px; font-weight: 600; white-space: nowrap; font-family: inherit; cursor: pointer; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-secondary);">${r.act2.label}</button>` : null}
                    </div>
                  ` : null}
                </div>
              `)}
              <!-- 학습값은 행 없이 각주만(늘지 않는 데이터) — 관리 위치 링크 -->
              ${(dataFootnote) ? html`
                <div style="display: flex; align-items: center; gap: 10px; margin-top: 16px; padding-top: 13px; border-top: 1px solid var(--border-light); font-size: 11px; color: var(--text-muted); flex-wrap: wrap;">
                  <span style="flex: 1 1 320px; min-width: 0; line-height: 1.5;">${dataFootnote}</span>
                  <button onClick=${onGoCriteria} style="flex-shrink: 0; height: 26px; padding: 0 11px; border-radius: 5px; border: 1px solid var(--border-default); background: transparent; color: var(--text-secondary); font-size: 11px; font-weight: 600; cursor: pointer;">판정 기준으로 이동</button>
                </div>
              ` : null}
            </div>
          ` : null}

          <!-- 저장 막대 하단 고정 — 긴 태그 목록 아래로 버튼이 밀리는 것 방지 -->
          <div style="position: sticky; bottom: 0; z-index: 5; display: flex; align-items: center; gap: 14px; margin-top: 20px; padding: 12px 0; background: var(--bg-canvas); border-top: 1px solid ${settingsDirty ? 'rgba(217,154,43,.45)' : 'var(--border-default)'};">
            <button onClick=${onSaveSettings} style="height: 38px; padding: 0 22px; border-radius: 6px; border: none; background: var(--primary-base); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;">저장</button>
            ${(settingsDirty) ? html`<span style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--warning);"><span class="codicon codicon-circle-filled" style="font-size: 8px;"></span>저장하지 않은 변경사항이 있습니다</span>` : null}
          </div>
        </div>
      </div>
    ` : null}

    ${(dlOpen) ? html`
      <div onClick=${onCloseDownload} style="position: fixed; inset: 0; z-index: 195; background: var(--overlay-scrim); display: flex; align-items: center; justify-content: center; padding: 24px;">
        <div onClick=${stopClick} style="width: 100%; max-width: 420px; background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 10px; box-shadow: 0 8px 40px rgba(0,0,0,.55); overflow: hidden;">
          <div style="display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--border-default);">
            <span class="codicon codicon-desktop-download" style="font-size: 16px; color: var(--primary-light);"></span>
            <div style="flex: 1; font-size: 14px; font-weight: 700; color: var(--text-primary);">이벤트 기록 내보내기</div>
            <button onClick=${onCloseDownload} title="닫기" style="width: 28px; height: 28px; border-radius: 5px; border: 1px solid var(--border-default); background: transparent; color: var(--text-muted); cursor: pointer;"><span class="codicon codicon-close" style="font-size: 13px;"></span></button>
          </div>
          <div style="padding: 18px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 7px;">기간</label>
            <div style="margin-bottom: 16px;"><${DateRange} ...${csvRange} /></div>
            <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 7px;">파일 형식</label>
            <select value=${dlFmt} onChange=${onDlFmt} style="width: 100%; height: 34px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px; margin-bottom: 20px;"><option value="csv">CSV (Excel)</option><option value="json">JSON</option></select>
            <div style="display: flex; gap: 8px;">
              <button onClick=${onCloseDownload} style="flex: 1; height: 38px; border-radius: 6px; border: 1px solid var(--border-medium); background: transparent; color: var(--text-secondary); font-size: 13px; font-weight: 600; cursor: pointer;">취소</button>
              <button onClick=${onDoDownload} style="flex: 1.4; height: 38px; border-radius: 6px; border: none; background: var(--primary-base); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;"><span class="codicon codicon-desktop-download" style="font-size: 13px; vertical-align: -2px; margin-right: 5px;"></span>다운로드</button>
            </div>
          </div>
        </div>
      </div>
    ` : null}

    <!-- 리포트 삭제 확인 — 비가역이라 오버레이 클릭으로 안 닫힘 -->
    ${(delRepOpen) ? html`
      <div style="position: fixed; inset: 0; z-index: 200; background: var(--overlay-scrim); display: flex; align-items: center; justify-content: center; padding: 24px;">
        <div style="width: 440px; max-width: calc(100vw - 40px); background: var(--bg-elevated); border: 1px solid var(--border-default); border-radius: 10px; padding: 22px; box-shadow: 0 8px 40px rgba(0,0,0,.5);">
          <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px;">리포트 삭제</div>
          <div style="font-size: 12.5px; color: var(--text-secondary); line-height: 1.7; margin-bottom: 10px;">이 리포트 파일을 삭제합니다. 되돌릴 수 없습니다.</div>
          <div style="padding: 10px 13px; border-radius: 7px; background: var(--bg-secondary); border: 1px solid var(--border-light); margin-bottom: 16px;">
            <div style="font-size: 12.5px; color: var(--text-primary); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${delRepName}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">생성 ${delRepDate}</div>
          </div>
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button onClick=${onDelRepCancel} style="height: 34px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--border-default); background: transparent; color: var(--text-secondary); font-size: 13px; cursor: pointer;">취소</button>
            <button onClick=${onDelRepDo} style="height: 34px; padding: 0 16px; border-radius: 6px; border: none; background: var(--danger); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;">삭제</button>
          </div>
        </div>
      </div>
    ` : null}

    ${/* 추출 주기 변경 모달 — 이전 구간과 밀도가 달라지므로 영향 안내 후 처리 방법 선택 */ ''}
    ${(bandIvOpen) ? html`
      <div style="position: fixed; inset: 0; z-index: 200; background: var(--overlay-scrim); display: flex; align-items: center; justify-content: center; padding: 24px;">
        <div style="width: 480px; max-height: 100%; overflow: auto; background: var(--bg-elevated); border: 1px solid var(--border-default); border-radius: 10px; padding: 22px; box-shadow: 0 8px 40px rgba(0,0,0,.5);">
          <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 14px;">대역·결함 패턴 추출 주기 변경</div>
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">
            <span style="font-size: 13px; font-family: var(--font-mono); color: var(--text-muted);">${bandIntervalKo}</span>
            <span class="codicon codicon-arrow-right" style="font-size: 12px; color: var(--text-muted);"></span>
            <select value=${bandIvNext} onChange=${onBandIvPick} style="height: 32px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 13px;"><option value="10m">10분</option><option value="30m">30분</option><option value="1h">1시간</option></select>
          </div>
          <div style="font-size: 12px; color: var(--text-tertiary); line-height: 1.9; padding: 12px 14px; border-radius: 7px; background: var(--bg-secondary); margin-bottom: 16px;">
            ${(bandIvFacts || []).map((f) => html`<div style="display: flex; gap: 10px;"><span style="color: var(--text-muted); min-width: 118px;">${f.k}</span><span style="color: ${f.warn ? 'var(--warning)' : 'var(--text-secondary)'}; font-weight: ${f.warn ? '600' : '500'};">${f.v}</span></div>`)}
          </div>
          <div style="font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 8px;">이전 구간 처리</div>
          ${(bandIvChoices || []).map((c) => html`
            <label style=${c.style}>
              <input type="radio" name="bandivact" checked=${c.on} onChange=${c.onPick} style="margin-top: 3px;" />
              <span>
                <span style="display: block; font-size: 13px; color: var(--text-primary); font-weight: 500;">${c.label}</span>
                <span style="display: block; font-size: 11px; color: var(--text-muted); line-height: 1.6; margin-top: 2px;">${c.desc}</span>
              </span>
            </label>
          `)}
          <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px;">
            <button onClick=${onBandIvCancel} style="height: 34px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--border-default); background: transparent; color: var(--text-secondary); font-size: 13px; cursor: pointer;">취소</button>
            <button onClick=${onBandIvApply} disabled=${bandIvSame} style=${bandIvApplyStyle}>적용</button>
          </div>
        </div>
      </div>
    ` : null}

    <!-- 태그별 정리 — 감시 목록 밖 태그 데이터 선택 삭제(기간 삭제는 다른 태그까지 삭제) -->
    ${(orphanOpen) ? html`
      <div style="position: fixed; inset: 0; z-index: 200; background: var(--overlay-scrim); display: flex; align-items: center; justify-content: center;">
        <div style="width: 560px; max-width: calc(100vw - 40px); background: var(--bg-elevated); border: 1px solid var(--border-default); border-radius: 10px; padding: 22px; box-shadow: 0 8px 40px rgba(0,0,0,.5);">
          <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">감시 목록에 없는 태그</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px; line-height: 1.55;">
            데이터는 남아 있는데 지금 감시하지 않는 태그입니다 — 설비를 철거했거나 데이터 소스에서 뺀 경우입니다.
            지우면 그 태그의 대역 추이·이벤트 이력·판정 상태가 함께 사라집니다. 되돌릴 수 없습니다.
          </div>
          ${(orphanTotalText) ? html`<div style="font-size: 11.5px; color: var(--text-secondary); font-variant-numeric: tabular-nums; margin-bottom: 10px;">${orphanTotalText}</div>` : null}
          <div style="max-height: 320px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: 8px;">
            ${(orphanRows || []).map((r) => html`
              <div style="display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center; padding: 11px 13px; border-bottom: 1px solid var(--border-light);">
                <div style="min-width: 0;">
                  <div style="font-size: 13px; color: var(--text-primary); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${r.key}</div>
                  <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px; font-variant-numeric: tabular-nums;">${r.stat}</div>
                </div>
                <button onClick=${r.onDelete} disabled=${!!orphanBusy} style="height: 28px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-medium); background: transparent; color: ${orphanBusy ? 'var(--text-muted)' : '#e5484d'}; font-size: 12px; font-weight: 600; font-family: inherit; cursor: ${orphanBusy ? 'not-allowed' : 'pointer'};">${r.busy ? '지우는 중…' : '삭제'}</button>
              </div>
            `)}
          </div>
          <div style="display: flex; gap: 8px; justify-content: space-between; align-items: center; margin-top: 16px;">
            <button onClick=${onOrphanAll} disabled=${!!orphanBusy} style="height: 34px; padding: 0 14px; border-radius: 6px; border: none; font-size: 13px; font-weight: 600; color: #fff; background: ${orphanBusy ? 'var(--text-muted)' : '#e5484d'}; cursor: ${orphanBusy ? 'not-allowed' : 'pointer'}; font-family: inherit;">${orphanBusy === 'all' ? '지우는 중…' : '전부 삭제'}</button>
            <button onClick=${onOrphanClose} style="height: 34px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--border-default); background: transparent; color: var(--text-secondary); font-size: 13px; cursor: pointer; font-family: inherit;">닫기</button>
          </div>
        </div>
      </div>
    ` : null}

    <!-- 삭제 1단계 — 날짜 선택(아직 삭제 없음, 다음 단계가 건수 확인) -->
    ${(purgePickShow) ? html`
      <div style="position: fixed; inset: 0; z-index: 200; background: var(--overlay-scrim); display: flex; align-items: center; justify-content: center;">
        <div style="width: 420px; background: var(--bg-elevated); border: 1px solid var(--border-default); border-radius: 10px; padding: 22px; box-shadow: 0 8px 40px rgba(0,0,0,.5);">
          <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">${purgePickTitle}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px;">지울 기간을 정하세요. 다음 화면에서 지워질 양을 확인한 뒤 실행합니다.</div>
          ${(purgeHaveText) ? html`<div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-bottom: 12px;">${purgeHaveText}</div>` : null}
          <div style="margin-bottom: 20px;"><${DateRange} ...${purgeRange} /></div>
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button onClick=${onPurgePickCancel} style="height: 34px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--border-default); background: transparent; color: var(--text-secondary); font-size: 13px; cursor: pointer;">취소</button>
            <button onClick=${onPurgePickNext} disabled=${!purgePickReady} style="height: 34px; padding: 0 14px; border-radius: 6px; border: none; font-size: 13px; font-weight: 600; color: #fff; background: ${purgePickReady ? 'var(--primary-base)' : 'var(--text-muted)'}; cursor: ${purgePickReady ? 'pointer' : 'not-allowed'}; opacity: ${purgePickReady ? '1' : '.55'};">선택</button>
          </div>
        </div>
      </div>
    ` : null}

    <!-- 삭제 2단계 — 확인(디자인 시스템 Modal 구조) -->
    ${(purgeShow) ? html`
      <div style="position: fixed; inset: 0; z-index: 201; background: var(--overlay-scrim); display: flex; align-items: center; justify-content: center;">
        <div style="width: 460px; background: var(--bg-elevated); border: 1px solid var(--border-default); border-radius: 10px; padding: 22px; box-shadow: 0 8px 40px rgba(0,0,0,.5);">
          <div style="display: flex; align-items: center; gap: 9px; margin-bottom: 16px;">
            <span class="codicon codicon-warning" style="color: var(--danger); font-size: 17px;"></span>
            <span style="font-size: 16px; font-weight: 700; color: var(--text-primary);">${purgeAsk}</span>
            <span style="margin-left: auto; font-size: 12px; color: var(--text-muted);">${purgeTitle}</span>
          </div>

          <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 14px 16px; border-radius: 8px; margin-bottom: 16px; background: rgba(255,71,71,.09); border: 1px solid rgba(255,71,71,.34);">
            <div style="min-width: 0;">
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">삭제 대상</div>
              <div style="font-size: 30px; font-weight: 800; line-height: 1; letter-spacing: -.5px; font-variant-numeric: tabular-nums; color: ${purgeCounting ? 'var(--text-muted)' : 'var(--danger)'};">${purgeCounting ? '세는 중…' : purgeN}</div>
            </div>
            <div style="text-align: right; font-size: 11.5px; color: var(--text-secondary); font-variant-numeric: tabular-nums;">
              <div style="font-family: var(--font-mono);">${purgeWhen}</div>
              <div style="color: var(--text-muted); margin-top: 3px;">${purgeKeep}</div>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 7px; margin-bottom: 18px;">
            <!-- 대안 항목(내보내기 권장)은 굵기로 구분 — 색은 링크로 읽힘 -->
            ${(purgeBullets || []).map((b) => html`
              <div style="display: flex; gap: 9px; font-size: 12px; line-height: 1.5; color: var(--text-secondary); font-weight: ${b.tip ? '700' : '400'};">
                <span style="color: var(--text-muted); flex-shrink: 0; font-weight: 400;">–</span><span>${b.t}</span>
              </div>
            `)}
          </div>

          <!-- 마지막 관문 — 표 이름 입력 시에만 삭제 버튼 활성(비가역) -->
          <div style="font-size: 11.5px; color: var(--text-muted); margin-bottom: 7px;">계속하려면 테이블 이름 <b style="color: var(--text-secondary); font-family: var(--font-mono);">${purgeSub}</b> 을 입력하세요</div>
          <input value=${purgeTyped} onInput=${onPurgeType} placeholder=${purgeSub} spellcheck="false" autocomplete="off"
            style="width: 100%; box-sizing: border-box; height: 36px; padding: 0 12px; border-radius: 6px; font-size: 13px; font-family: var(--font-mono); background: var(--bg-input-dark); color: var(--text-primary); margin-bottom: 18px; border: 1px solid ${purgeTypeOk ? 'rgba(58,167,109,.6)' : 'var(--border-medium)'};" />

          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button onClick=${onPurgeCancel} style="height: 34px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--border-default); background: transparent; color: var(--text-secondary); font-size: 13px; cursor: pointer;">취소</button>
            <button onClick=${onPurgeConfirm} disabled=${!purgeReady} style="height: 34px; padding: 0 15px; border-radius: 6px; border: none; font-size: 13px; font-weight: 700; color: #fff; background: ${purgeReady ? '#e5484d' : 'var(--text-muted)'}; cursor: ${purgeReady ? 'pointer' : 'not-allowed'}; opacity: ${purgeReady ? '1' : '.55'};">${purgeBtnLabel}</button>
          </div>
        </div>
      </div>
    ` : null}

    ${(pendingNavOpen) ? html`
      <div style="position: fixed; inset: 0; z-index: 200; background: var(--overlay-scrim); display: flex; align-items: center; justify-content: center;">
        <div style="width: 400px; background: var(--bg-elevated); border: 1px solid var(--border-default); border-radius: 10px; padding: 22px; box-shadow: 0 8px 40px rgba(0,0,0,.5);">
          <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px;"><span class="codicon codicon-warning" style="color: var(--warning); font-size: 18px;"></span>저장하지 않은 변경사항</div>
          <div style="font-size: 13px; color: var(--text-tertiary); line-height: 1.6; margin-bottom: 20px;">설정에 저장하지 않은 변경사항이 있습니다. 이동하면 변경사항이 사라질 수 있습니다.</div>
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button onClick=${onConfirmCancel} style="height: 34px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--border-default); background: transparent; color: var(--text-secondary); font-size: 13px; cursor: pointer;">취소</button>
            <button onClick=${onConfirmDiscard} style="height: 34px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-secondary); font-size: 13px; cursor: pointer;">버리고 이동</button>
            <button onClick=${onConfirmSave} style="height: 34px; padding: 0 14px; border-radius: 6px; border: none; background: var(--primary-base); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;">저장 후 이동</button>
          </div>
        </div>
      </div>
    ` : null}

  </main>

  ${(toast) ? html`
    <div style=${toastStyle}><span class="codicon codicon-${toastIcon}" style="font-size: 15px;"></span>${toastMsg}</div>
  ` : null}

  ${(idSwitchShow) ? html`
    <div style="position: fixed; inset: 0; z-index: 400; background: var(--overlay-scrim); display: flex; align-items: center; justify-content: center; padding: 16px;">
      <div style="width: 440px; max-width: 100%; background: var(--bg-elevated); border: 1px solid var(--border-default); border-radius: 10px; padding: 22px; box-shadow: 0 8px 40px rgba(0,0,0,.5);">
        <div style="display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 10px;"><span class="codicon codicon-account" style="color: var(--warning); font-size: 18px;"></span>다른 계정으로 로그인되었습니다</div>
        <div style="font-size: 13px; color: var(--text-tertiary); line-height: 1.7; margin-bottom: 20px;">
          이 브라우저의 로그인이 <b style="color: var(--text-primary);">${idSwitchTo}</b>(으)로 바뀌었습니다. 이 화면은 <b style="color: var(--text-primary);">${idSwitchFrom}</b> 계정용이라 저장·판정·알림 기록을 모두 멈췄습니다.<br />
          새로고침하면 ${idSwitchTo} 계정으로 다시 엽니다. ${idSwitchMon}<br />
          ${idSwitchFrom}(으)로 다시 로그인하면 이 안내는 사라집니다.
        </div>
        <div style="display: flex; justify-content: flex-end;">
          <button onClick=${onIdReload} style="height: 34px; padding: 0 16px; border-radius: 6px; border: none; background: var(--primary-base); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;">새로고침</button>
        </div>
      </div>
    </div>
  ` : null}

</div>
`;
}
