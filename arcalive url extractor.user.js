// ==UserScript==
// @name         아카라이브 게시글 URL 추출
// @namespace    http://tampermonkey.net/
// @version      3.9
// @description  아카라이브에서 게시글 URL 추출 + 읽음무시 + 이미지글 필터링 + 무제한 페이지 지원
// @author       kts + mod
// @match        https://arca.live/b/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=arca.live
// @grant        none
// @require      https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js
// @updateURL    https://raw.githubusercontent.com/sb03son/tampermonkey-scripts/main/arcalive-url-extractor.user.js
// @downloadURL  https://raw.githubusercontent.com/sb03son/tampermonkey-scripts/main/arcalive-url-extractor.user.js
// ==/UserScript==

// 💡 [제거] 더 이상 필요하지 않은 sleep 및 promptForIPChange 함수를 제거했습니다.

(function () {
    'use strict';
    /* globals $ */

    const articlestring = localStorage.getItem('recent_articles');
    const articles = articlestring ? JSON.parse(articlestring) : [];

    let isEnd = false;
    let saved_str = "";
    let idx = 0;

    const get_url_div = `
<div class='sidebar-item sidebar_urls'>
  <div class='item-title'>게시글 URL 추출</div>
  <div class='input-group'>
    <div class='input-group-prepend'>
      <select class='form-control form-control-sm' name='target'>
        <option value='1'>전체</option>
        <option value='0'>읽은글 무시</option>
        <option value='3'>미디어 있는 글만</option>
        <option value='2'>미디어 숨긴 글만</option>
      </select>
    </div>
    <div class='input-group-prepend'>
      <input type='number' class='form-control form-control-sm page-count' value='1' min='0' style='width:60px;' title='가져올 페이지 수'>
    </div>
    <div class='input-group-prepend'>
  <input type='datetime-local' class='form-control form-control-sm end-date' style='width:200px;' title='이 날짜·시간까지 추출'>
</div>
    <div class='input-group-append'>
      <button class='btn btn-arca btn-sm sidebar_get_urls'>추출</button>
      <button class='btn btn-arca btn-sm sidebar_copy_urls'>복사</button>
    </div>
  </div>
<br>
  <div class='sidebar_results'>
    <span>
      <p>읽은글 무시는 이미 읽은 글을 무시하는 옵션이에요.</p>
      <p>페이지를 0으로 설정하면 이후 모든 페이지에 대해 적용돼요.</p>
      <p>결과화면에서 휠을 굴리면 url을 수동으로 복사할 수 있어요.</p>
      <p>좌클릭으로 목록에서 삭제, 휠클릭으로 새탭에서 링크 열기를 할 수 있어요.</p>
      <p>미디어 관련 옵션은 개념글을 놓쳐요. 념글은 따로 확인해 주세요.</p>
    </span>
  </div>
</div>`;

    if ($(".sticky-container").length) {
        $(".sticky-container").before(get_url_div);
    } else {
        $("aside.right-sidebar").append(get_url_div);
    }

    // 중복 방지용 Set
    const seenUrls = new Set();

    // 추출 함수
    async function extractFromDocument(docOrUrl, cnt_pass, baseForResolve, targetEndDate) {
        let $doc;
        let baseURLObj;

        if (typeof docOrUrl === "string") {
            const fetchUrl = docOrUrl;
            
            let response;
            try {
                // 단순 fetch 요청
                response = await fetch(fetchUrl);
            } catch (e) {
                console.error(`[Fatal Error] Network error during fetch: ${e.message}. 수동으로 새로고침 후 재시작하세요.`);
                return null; // 네트워크 오류 발생 시 즉시 종료
            }

            // 💡 [최종 수정] 429, 403 오류 시 재시도 없이 즉시 종료
            if (response.status === 429 || response.status === 403) {
                console.error(`[Fatal Error] HTTP Status ${response.status} received. 서버가 접근을 차단했습니다. 수동으로 해결(CAPTCHA, IP/세션 변경) 후 페이지 새로고침하여 재시작하세요.`);
                return null; // 429/403 오류 발생 시 즉시 종료
            }

            if (!response.ok) {
                // 500, 404 등 다른 오류 처리
                console.error(`[Error] HTTP Status ${response.status} received for URL: ${fetchUrl}. 추출을 중단합니다.`);
                return null;
            }
            
            // 성공적인 응답을 사용하여 HTML 파싱 진행
            const html = await response.text();
            const parsed = new DOMParser().parseFromString(html, "text/html");
            $doc = $(parsed);
            baseURLObj = new URL(fetchUrl, location.origin);
        } else {
            $doc = $(docOrUrl);
            baseURLObj = baseForResolve ? new URL(baseForResolve, location.origin) : new URL(location.href);
        }

        let link_sum = "";

        $doc.find("a.column").not(".notice").each(function () {
            const rawHref = $(this).attr("href") || "";
            let absHref;
            try {
                absHref = new URL(rawHref, baseURLObj).toString();
            } catch (e) {
                absHref = rawHref;
            }

            let normalizedUrl;
            try {
                let urlObj = new URL(absHref);
                // ? 뒤의 쿼리스트링 제거
                normalizedUrl = urlObj.origin + urlObj.pathname;
            } catch (e) {
                normalizedUrl = absHref.split('?')[0]; // 혹시 URL 생성 실패하면 그냥 ? 앞부분만
            }

            const title = $(this).find("span.title").text();

            const articleIdMatch = absHref.match(/\/b\/[^\/]+\/(\d+)/);
            const article_Id = articleIdMatch ? articleIdMatch[1] : null;

            let isExisting = false;
            if (article_Id) {
                isExisting = Array.isArray(articles) && articles.some(article => article.articleId === Number(article_Id));
            }

            if (isExisting && cnt_pass === 0) return true;

            //미디어 처리
            if (cnt_pass === 2 || cnt_pass === 3) {
                const hasMediaIcon = $(this)
                .find("div.vrow-inner div.vrow-top span.vcol.col-title span.title span.media-icon.ion-ios-photos-outline, div.vrow-inner div.vrow-top span.vcol.col-title span.title span.media-icon.ion-ios-videocam")
                .length > 0;
                if (!hasMediaIcon) return true;

                if (cnt_pass === 2 && $(this).find("div.vrow-preview").length > 0) return true;
            }

            // ✅ 중복 방지: 이미 저장된 URL이면 건너뛰기
            if (seenUrls.has(normalizedUrl)) return true;
            seenUrls.add(normalizedUrl);

            const urls = "<span class='copy_url' title='" + title + "' url_id ='" + (idx++) + "' url='" + normalizedUrl + "'>" + idx + ": " + title + "<br></span>";
            $(".sidebar_results").prepend(urls);
            link_sum = normalizedUrl + ' ' + link_sum;

        });

        saved_str += link_sum;

        // ✅ 날짜 조건 확인
        if (targetEndDate) {
            const lastTimeEl = $doc.find('a.column time').last();
            if (lastTimeEl.length) {
                const lastTimeStr = lastTimeEl.attr('datetime'); // ISO 포맷
                if (lastTimeStr) {
                    try {
                        const lastTime = new Date(lastTimeStr);
                        if (lastTime < targetEndDate) {
                            return null; // 날짜 조건 충족 → 중단
                        }
                    } catch (e) { }
                }
            }
        }

        // 다음 페이지 찾기
        let nextHref = null;

        const $activePageItem = $doc.find('li.page-item.active');
        const $nextPageItem = $activePageItem.next('li.page-item');

        if ($nextPageItem.length) {
            const nextLink = $nextPageItem.find('a').attr('href');
            if (nextLink) {
                 nextHref = new URL(nextLink, baseURLObj).toString();
            }
        }
        
        console.log(`[Debug] Total URLs: ${idx} | Next Page URL: ${nextHref}`);
        
        return nextHref;

    }

    // 추출 버튼 클릭
    $(document).on("click", "button.sidebar_get_urls", async function () {
        isEnd = false; // 시작 시 false
        const $results = $(".sidebar_results");
        $results.empty();

        idx = 0;
        saved_str = "";
        seenUrls.clear();
        
        let cnt_pass = Number($(this).closest('.input-group').find('select[name=target]').val()) || 0;
        
        // 페이지 카운트 로직 (0:무한, ""/유효하지 않은 값:1)
        let pageCount = Number($('.page-count').val());
        pageCount = (pageCount === 0) ? 0 : (pageCount || 1);

        const endDateInput = $('.end-date').val();
        const targetEndDate = endDateInput ? new Date(endDateInput) : null;

        const currentUrl = new URL(location.href);
        currentUrl.searchParams.delete('p');
        const baseUrl = currentUrl.toString().replace(/\/$/, '');

        // 💡 [수정] 추출 로직 전체를 try 블록으로 감싸 isEnd 보장
        try {
            // 현재 페이지부터 추출
            let beforeIdx = idx;
            let nextUrl = await extractFromDocument(document, cnt_pass, baseUrl, targetEndDate);
            let perPageCount = idx - beforeIdx; // 첫 페이지 글 수

            // 반복 (while)
            if (targetEndDate) {
                // 날짜·시간 기준 추출 (페이지 수 무시)
                while (nextUrl) {
                    let fetchTarget = nextUrl;
                    nextUrl = await extractFromDocument(fetchTarget, cnt_pass, baseUrl, targetEndDate);
                }
            } else {
                // 페이지 수 기준 추출
                if (pageCount === 0) {
                    // 무제한 페이지 추출 (pageCount가 0일 때)
                    while (nextUrl) {
                        let fetchTarget = nextUrl;
                        nextUrl = await extractFromDocument(fetchTarget, cnt_pass, baseUrl, targetEndDate);
                    }
                } else {
                    // 지정된 페이지 수까지 추출 (pageCount가 1 이상일 때)
                    while (nextUrl && idx < perPageCount * pageCount) {
                        let fetchTarget = nextUrl;
                        nextUrl = await extractFromDocument(fetchTarget, cnt_pass, baseUrl, targetEndDate);
                    }
                }
            }
        } catch(e) {
            console.error("Extraction process stopped unexpectedly:", e);
        } finally {
            // 💡 [필수] 추출 성공/실패 여부에 관계없이 isEnd는 항상 true로 설정됩니다.
            isEnd = true;
        }
    });

    // 복사 버튼
    $(document).on("click", "button.sidebar_copy_urls", function () {
        // 💡 [수정] isEnd 조건 제거. 내용만 있으면 복사 허용
        if (saved_str.trim() !== "") {
            navigator.clipboard.writeText(saved_str);
            console.log("복사됨:", saved_str);
        } else {
            console.log("먼저 추출 버튼을 눌러주세요.");
        }
    });

    // 휠 스크롤로 제목↔URL 전환
    $(document).on("wheel", ".sidebar_results", function () {
        // isEnd 조건 유지 (안정성 보장)
        if (isEnd) {
            let temp_str = $(".sidebar_results").html();
            $(".sidebar_results").html(saved_str);
            saved_str = temp_str;
        }
    });

    // 클릭 시 개별 복사 + 목록에서 제거
    $(document).on("click", "span.copy_url", function () {
        const urlToCopy = $(this).attr('url');
        navigator.clipboard.writeText(urlToCopy);
        saved_str = saved_str.split(' ').filter(url => url.trim() !== urlToCopy).join(' ');
        $(this).remove();
    });

    // 가운데 클릭 시 새 탭 열기
    $(document).on("mousedown", "span.copy_url", function (e) {
        if (e.which === 2) {
            e.preventDefault();
            const urlToOpen = $(this).attr('url');
            window.open(urlToOpen, '_blank');
        }
    });

})();
