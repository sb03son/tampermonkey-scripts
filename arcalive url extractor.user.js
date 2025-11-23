// ==UserScript==
// @name         아카라이브 게시글 URL 추출
// @namespace    http://tampermonkey.net/
// @version      3.6
// @description  아카라이브에서 게시글 URL 추출 + 읽음무시 + 이미지글 필터링 + 무제한 페이지 지원
// @author       kts + mod
// @match        https://arca.live/b/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=arca.live
// @grant        none
// @require      https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js
// @updateURL    https://raw.githubusercontent.com/sb03son/tampermonkey-scripts/main/arcalive-url-extractor.user.js
// @downloadURL  https://raw.githubusercontent.com/sb03son/tampermonkey-scripts/main/arcalive-url-extractor.user.js
// ==/UserScript==

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function promptForIPChange() {
    return new Promise((resolve, reject) => {
        const message = "🚨 Rate Limit Block (HTTP 429) 🚨\n\n아카라이브 서버가 현재 IP 주소를 차단했습니다.\n\n추출을 재개하려면 다음 단계를 수행해 주세요:\n\n1. VPN, 프록시, 또는 모바일 핫스팟 연결을 변경하여 공인 IP 주소를 바꿉니다.\n2. **[확인] 버튼을 누르기 전에 새로운 IP 주소로 연결이 완료되었는지 확인하세요.**";
        
        // window.confirm은 브라우저를 블로킹하여 사용자의 행동을 기다립니다.
        if (window.confirm(message)) {
            resolve();
        } else {
            // 사용자가 취소(Cancel)를 누르면 추출을 중지합니다.
            reject(new Error("User manually stopped extraction."));
        }
    });
}

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
            
            // 429 오류 발생 시 재시도 로직 시작
            let response;
            let retries = 0;
            const maxRetries = 5;
            // const initialDelayMs = 5000; 

            while (retries < maxRetries) {
                console.log(`[Debug] Attempting fetch for: ${fetchUrl} (Attempt ${retries + 1}/${maxRetries})`);
                try {
                    response = await fetch(fetchUrl);

                    if (response.status === 429) {
                        retries++;
                        
                        console.warn(`[Warning] HTTP 429 Too Many Requests received. Prompting user to change IP.`);
                        
                        // 💡 [수정] 대기 시간 대신 사용자 프롬프트 호출 및 취소 처리
                        try {
                            await promptForIPChange();
                        } catch (e) {
                            console.error(e.message);
                            return null; // 사용자가 취소했으므로 추출 중지
                        }
                        
                        continue; // 사용자 확인 후 재시도
                    }

                    if (!response.ok) {
                        // 429 외의 다른 오류 처리 
                        console.error(`[Error] HTTP Status ${response.status} received for URL: ${fetchUrl}. Stopping retries for this URL.`);
                        return null;
                    }
                    
                    // 성공 (status 200-299)
                    break; 

                } catch (e) {
                    // 💡 [수정] 네트워크 오류 발생 시에도 IP 변경 프롬프트 호출로 대체
                    retries++;
                    // const delay = 5000 * retries; // 이 줄을 제거했습니다.
                    console.error(`[Error] Network error during fetch. Prompting user for manual intervention. Error: ${e.message}`);
                    
                    try {
                        await promptForIPChange(); // IP 변경 프롬프트 호출
                    } catch (e) {
                        console.error(e.message);
                        return null; // 사용자가 취소했으므로 추출 중지
                    }
                    
                    // await sleep(delay); // 이 줄을 제거했습니다.
                    continue; // 재시도
                }
            }
            
            if (!response || response.status === 429) {
                console.error(`[Fatal] Failed to fetch URL after ${maxRetries} retries due to persistent 429 or network error.`);
                return null; // 최종 실패
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
        // 429 오류 발생 시 재시도 로직 끝

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
        isEnd = false;
        const $results = $(".sidebar_results");
        $results.empty();

        idx = 0;
        saved_str = "";
        seenUrls.clear();        
        let cnt_pass = Number($(this).closest('.input-group').find('select[name=target]').val()) || 0;
        let pageCount = Number($('.page-count').val());
        pageCount = (pageCount === 0) ? 0 : (pageCount || 1);

        const endDateInput = $('.end-date').val();
        const targetEndDate = endDateInput ? new Date(endDateInput) : null;

        const currentUrl = new URL(location.href);
        currentUrl.searchParams.delete('p');
        const baseUrl = currentUrl.toString().replace(/\/$/, '');

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

    isEnd = true;
});

    // 복사 버튼
    $(document).on("click", "button.sidebar_copy_urls", function () {
        if (isEnd && saved_str.trim() !== "") {
            navigator.clipboard.writeText(saved_str);
            console.log("복사됨:", saved_str);
        } else {
            console.log("먼저 추출 버튼을 눌러주세요.");
        }
    });

    // 휠 스크롤로 제목↔URL 전환
    $(document).on("wheel", ".sidebar_results", function () {
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
