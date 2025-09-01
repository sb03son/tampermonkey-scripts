// ==UserScript==
// @name         아카라이브 아카콘 URL 추출
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  아카라이브에서 아카콘 URL 추출
// @author       kts + mod
// @match        https://arca.live/e/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=arca.live
// @grant        none
// @require      https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js
// @updateURL    https://raw.githubusercontent.com/sb03son/tampermonkey-scripts/main/arcalive-url-extractor.user.js
// @downloadURL  https://raw.githubusercontent.com/sb03son/tampermonkey-scripts/main/arcalive-url-extractor.user.js
// ==/UserScript==

(function () {
    'use strict';
    /* globals $ */
    let isEnd = false;
    let saved_str = "";
    let idx = 0;

        const get_url_div = `
<div class='sidebar-item sidebar_urls'>
  <div class='item-title'>아카콘 URL 추출</div>

  <div class='input-group mb-2'>
    <div class='input-group-prepend'>
      <span class='input-group-text'>추천수:</span>
      <input type='number' class='form-control form-control-sm min-sales' value='0' min='0' style='width:80px;' title='최소 판매량'>
    </div>
  </div>

  <div class='input-group mb-2'>
    <div class='input-group-prepend'>
      <span class='input-group-text'>페이지:</span>
      <input type='number' class='form-control form-control-sm page-count' value='1' min='0' style='width:80px;' title='가져올 페이지 수'>
    </div>
  </div>

  <div class='mt-2'>
    <button class='btn btn-arca btn-sm sidebar_get_urls'>추출</button>
    <button class='btn btn-arca btn-sm sidebar_copy_urls'>복사</button>
  </div>

  <br>
  <div class='sidebar_results'>
    <span>
      <p>지정한 판매량 이상인 아카콘만 추출합니다.</p>
      <p>페이지를 0으로 설정하면 이후 모든 페이지에 대해 적용돼요.</p>
      <p>결과화면에서 휠을 굴리면 url을 수동으로 복사할 수 있어요.</p>
      <p>좌클릭으로 목록에서 삭제, 휠클릭으로 새탭에서 링크 열기를 할 수 있어요.</p>
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
    async function extractCore(docOrUrl, baseForResolve, minSales, isRankSort) {
        let $doc;
        let baseURLObj;

        if (typeof docOrUrl === "string") {
            const fetchUrl = docOrUrl;
            const res = await fetch(fetchUrl);
            const html = await res.text();
            const parsed = new DOMParser().parseFromString(html, "text/html");
            $doc = $(parsed);
            baseURLObj = new URL(fetchUrl, location.origin);
        } else {
            $doc = $(docOrUrl);
            baseURLObj = baseForResolve ? new URL(baseForResolve, location.origin) : new URL(location.href);
        }

        let link_sum = "";
        let stop = false;

        $doc.find("div.row.row-cols-2.row-cols-sm-3.row-cols-md-4.row-cols-xl-5 div.col.mb-4.emoticon-col")
            .filter(function () {
                return $(this).closest(".emoticon-list.mb-0").length === 0;
            })
            .each(function () {
                const rawHref = $(this).find("a").attr("href") || "";
                if (!rawHref) return true;

                const absHref = new URL(rawHref, "https://arca.live").toString();
                const title = $(this).find(".title").text().trim();
                const maker = $(this).find(".maker").text().trim();
                const salesText = $(this).find(".count span").text().trim();
                const sales = parseInt(salesText.replace(/[^0-9]/g, "")) || 0;

                // 판매량 조건
                if (minSales && sales < minSales) {
                    if (isRankSort) {
                        stop = true;
                        return false;
                    }
                    return true;
                }

                // 중복 방지
                if (seenUrls.has(absHref)) return true;
                seenUrls.add(absHref);

                const urls = `<span class='copy_url' title='${title}' url='${absHref}'>${++idx}: ${title} (${maker}, ${sales}개)<br></span>`;
                $(".sidebar_results").prepend(urls);
                link_sum = absHref + ' ' + link_sum;
            });

        saved_str += link_sum;

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
        return { nextHref, stop };
    }

    // 추출 버튼 클릭
    $(document).on("click", "button.sidebar_get_urls", async function () {
        const $results = $(".sidebar_results");
        $results.empty();

        idx = 0;
        saved_str = "";
        seenUrls.clear();

        const pageCount = Math.max(0, Number($('.page-count').val()) || 0);
        const minSales  = Math.max(0, Number($('.min-sales').val()) || 0);

        const currentUrl = new URL(location.href);
        currentUrl.searchParams.delete('p');
        const baseUrl = currentUrl.toString().replace(/\/$/, '');
        const isRankSort = currentUrl.searchParams.get("sort") === "rank";

        // 현재 페이지부터 추출
        let { nextHref, stop } = await extractCore(document, baseUrl, minSales, isRankSort);

        if (!stop) {
            if (pageCount === 0) {
                while (nextHref && !stop) {
                    const result = await extractCore(nextHref, baseUrl, minSales, isRankSort);
                    nextHref = result.nextHref;
                    stop = result.stop;
                }
            } else {
                for (let i = 1; i < pageCount && nextHref && !stop; i++) {
                    const result = await extractCore(nextHref, baseUrl, minSales, isRankSort);
                    nextHref = result.nextHref;
                    stop = result.stop;
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
