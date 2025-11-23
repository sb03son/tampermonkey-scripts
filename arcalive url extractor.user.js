// ==UserScript==
// @name         아카라이브 게시글 URL 추출
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  아카라이브에서 게시글 URL 추출 + 읽음무시 + 이미지글 필터링 + 무제한 페이지 지원 (버그 수정판)
// @author       kts + mod
// @match        https://arca.live/b/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=arca.live
// @grant        none
// @require      https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js
// ==/UserScript==

(function () {
    'use strict';
    /* globals $ */

    const articlestring = localStorage.getItem('recent_articles');
    const articles = articlestring ? JSON.parse(articlestring) : [];

    let isEnd = false;
    let saved_str = "";
    let idx = 0;

    // 중복 방지용 Set
    const seenUrls = new Set();

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
      <input type='number' class='form-control form-control-sm page-count' value='1' min='0' style='width:60px;' title='가져올 페이지 수 (0=무제한)'>
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
      <p>페이지를 0으로 설정하면 날짜 제한이나 끝까지 추출해요.</p>
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

    // 추출 함수
    async function extractFromDocument(docOrUrl, cnt_pass, baseForResolve, targetEndDate) {
        let $doc;
        let baseURLObj;

        if (typeof docOrUrl === "string") {
            try {
                const fetchUrl = docOrUrl;
                const res = await fetch(fetchUrl);
                const html = await res.text();
                const parsed = new DOMParser().parseFromString(html, "text/html");
                $doc = $(parsed);
                baseURLObj = new URL(fetchUrl, location.origin);
            } catch (err) {
                console.error("페이지 로드 실패:", err);
                return null;
            }
        } else {
            $doc = $(docOrUrl);
            baseURLObj = baseForResolve ? new URL(baseForResolve, location.origin) : new URL(location.href);
        }

        let link_sum = "";

        // 게시글 목록 순회
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
                normalizedUrl = urlObj.origin + urlObj.pathname; // 쿼리스트링 제거
            } catch (e) {
                normalizedUrl = absHref.split('?')[0];
            }

            const title = $(this).find("span.title").text().trim();

            const articleIdMatch = absHref.match(/\/b\/[^\/]+\/(\d+)/);
            const article_Id = articleIdMatch ? articleIdMatch[1] : null;

            // 읽은 글 필터링
            let isExisting = false;
            if (article_Id) {
                isExisting = Array.isArray(articles) && articles.some(article => article.articleId === Number(article_Id));
            }

            if (isExisting && cnt_pass === 0) return true; // 읽은 글 무시 옵션

            // 미디어 필터링
            if (cnt_pass === 2 || cnt_pass === 3) {
                const hasMediaIcon = $(this)
                    .find("div.vrow-inner div.vrow-top span.vcol.col-title span.title span.media-icon.ion-ios-photos-outline, div.vrow-inner div.vrow-top span.vcol.col-title span.title span.media-icon.ion-ios-videocam")
                    .length > 0;
                
                // 미디어 있는 글만(3)인데 아이콘 없으면 패스
                if (cnt_pass === 3 && !hasMediaIcon) return true;

                // 미디어 숨긴 글만(2): 아이콘은 있는데 미리보기가 있으면(숨김 아님) 패스
                if (cnt_pass === 2) {
                    if (!hasMediaIcon) return true; // 미디어 자체가 없으면 패스? (의도에 따라 다름, 보통 미디어 있는데 숨겨진 걸 찾음)
                    if ($(this).find("div.vrow-preview").length > 0) return true;
                }
            }

            // 중복 방지
            if (seenUrls.has(normalizedUrl)) return true;
            seenUrls.add(normalizedUrl);

            idx++;
            const urls = "<span class='copy_url' title='" + title + "' url_id ='" + idx + "' url='" + normalizedUrl + "'>" + idx + ": " + title + "<br></span>";
            $(".sidebar_results").prepend(urls);
            link_sum = normalizedUrl + ' ' + link_sum;
        });

        saved_str += link_sum;

        // 날짜 조건 확인 (이 페이지의 마지막 글이 타겟 날짜보다 과거라면 중단)
        if (targetEndDate) {
            const lastTimeEl = $doc.find('a.column time').last();
            if (lastTimeEl.length) {
                const lastTimeStr = lastTimeEl.attr('datetime');
                if (lastTimeStr) {
                    try {
                        const lastTime = new Date(lastTimeStr);
                        if (lastTime < targetEndDate) {
                            return null; // 날짜 조건 충족 -> 중단 신호
                        }
                    } catch (e) { }
                }
            }
        }

        // 다음 페이지 찾기
        let nextHref = null;
        const $activePageItem = $doc.find('li.page-item.active');
        
        // 1. active 바로 다음 li 확인
        let $nextPageItem = $activePageItem.next('li.page-item');
        
        // 2. 만약 바로 다음이 없다면(블록 끝), '다음' 화살표 찾기 (보통 aria-label='Next' 혹은 클래스 확인)
        if ($nextPageItem.length === 0 || $nextPageItem.hasClass('disabled')) {
             // 아카라이브 구조상 active 다음 요소가 없으면 다음 블록 화살표를 찾아야 할 수 있음. 
             // 보통 active가 마지막 숫자면, 그 부모 ul 내의 마지막 li가 next일 수 있음.
             const $nextArrow = $doc.find('ul.pagination li.page-item').last();
             if (!$nextArrow.hasClass('active') && !$nextArrow.hasClass('disabled')) {
                 $nextPageItem = $nextArrow;
             }
        }

        if ($nextPageItem.length) {
            const nextLink = $nextPageItem.find('a').attr('href');
            if (nextLink) {
                nextHref = new URL(nextLink, baseURLObj).toString();
            }
        }
        return nextHref;
    }

    // 추출 버튼 클릭
    $(document).on("click", "button.sidebar_get_urls", async function () {
        const $results = $(".sidebar_results");
        $results.empty();
        
        // 상태 초기화
        idx = 0;
        saved_str = "";
        isEnd = false;
        seenUrls.clear(); // 중요: 재검색 시 중복 필터 초기화

        let cnt_pass = Number($(this).closest('.input-group').find('select[name=target]').val()) || 0;
        let pageCount = Number($('.page-count').val()) || 1;
        const endDateInput = $('.end-date').val();
        const targetEndDate = endDateInput ? new Date(endDateInput) : null;

        const currentUrl = new URL(location.href);
        currentUrl.searchParams.delete('p'); // 현재 페이지 파라미터 제거
        const baseUrl = currentUrl.toString().replace(/\/$/, '');

        // 현재 페이지(1번째) 추출
        let nextUrl = await extractFromDocument(document, cnt_pass, baseUrl, targetEndDate);
        
        // 추가 페이지 탐색
        // fetchedPages: 현재까지 가져온 페이지 수 (첫 페이지는 위에서 했으므로 1부터 시작)
        let fetchedPages = 1;

        // 반복 조건: 다음 URL이 있고, (무제한(0) 이거나 아직 목표 페이지 수보다 덜 가져왔을 때)
        while (nextUrl) {
            // 날짜 지정이 없고, 페이지 제한이 걸려있으며, 이미 충분히 가져왔다면 중단
            if (!targetEndDate && pageCount > 0 && fetchedPages >= pageCount) {
                break;
            }

            // 서버 부하 방지용 미세 딜레이 (선택 사항, 필요 시 주석 해제)
            // await new Promise(r => setTimeout(r, 200)); 

            let fetchTarget = nextUrl;
            nextUrl = await extractFromDocument(fetchTarget, cnt_pass, baseUrl, targetEndDate);
            
            if (nextUrl === null) break; // 날짜 조건 등에 의해 중단된 경우
            fetchedPages++;
        }

        isEnd = true;
        console.log("추출 완료. 총 게시글:", idx);
    });

    // 복사 버튼
    $(document).on("click", "button.sidebar_copy_urls", function () {
        if (saved_str.trim() !== "") {
            navigator.clipboard.writeText(saved_str);
            // 알림 효과 (선택)
            const originText = $(this).text();
            $(this).text("완료!");
            setTimeout(() => $(this).text(originText), 1000);
        } else {
            alert("추출된 URL이 없거나 추출이 완료되지 않았습니다.");
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
        
        // saved_str에서도 제거 (공백 기준으로 split 후 다시 join)
        let urls = saved_str.split(' ');
        if(urls.length < 2 && saved_str.includes('<span')) { 
             // 현재 화면이 HTML 모드일 경우 saved_str는 HTML임.
             // 이 경우엔 saved_str(HTML) 업데이트는 휠 이벤트 때 처리되므로 여기선 UI만 제거하면 됨
        } else {
             // 텍스트 모드라면 문자열에서 제거
             saved_str = urls.filter(url => url.trim() !== urlToCopy).join(' ');
        }
        
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
