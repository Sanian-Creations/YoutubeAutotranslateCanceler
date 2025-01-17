// ==UserScript==
// @name         Youtube Auto-translate Canceler
// @namespace    https://github.com/pcouy/YoutubeAutotranslateCanceler/
// @version      0.4
// @description  Remove auto-translated youtube titles
// @author       Pierre Couy
// @contributor  Sanian
// @match        https://www.youtube.com/*
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.deleteValue
// ==/UserScript==

(async () => {
    'use strict';

    /*
    Get a YouTube Data v3 API key from https://console.developers.google.com/apis/library/youtube.googleapis.com?q=YoutubeData
    */
    let NO_API_KEY = false;
    let api_key_awaited = await GM.getValue("api_key");
    if (api_key_awaited === undefined || api_key_awaited === null || api_key_awaited === "") {
        await GM.setValue("api_key", prompt("Enter your API key. Go to https://developers.google.com/youtube/v3/getting-started to know how to obtain an API key, then go to https://console.developers.google.com/apis/api/youtube.googleapis.com/ in order to enable Youtube Data API for your key."));
    }

    api_key_awaited = await GM.getValue("api_key");
    if (api_key_awaited === undefined || api_key_awaited === null || api_key_awaited === "") {
        NO_API_KEY = true; // Resets after page reload, still allows local title to be replaced
        console.log("NO API KEY PRESENT");
    }
    const API_KEY = await GM.getValue("api_key");
    let API_KEY_VALID = false;
    console.log(API_KEY);

    let url_template = "https://www.googleapis.com/youtube/v3/videos?part=snippet&id={IDs}&key=" + API_KEY;

    let cachedTitles = {} // Dictionary(id, title): Cache of API fetches, survives only Youtube Autoplay

    let currentLocation; // String: Current page URL
    let changedDescription; // Bool: Changed description
    let alreadyChanged; // List(string): Links already changed

    function getVideoID(a) {
        while (a.tagName != "A") {
            a = a.parentNode;
        }
        let href = a.href;
        let tmp = href.split('v=')[1];
        return tmp.split('&')[0];
    }

    function resetChanged() {
        console.log(" --- Page Change detected! --- ");
        currentLocation = document.title;
        changedDescription = false;
        alreadyChanged = [];
    }
    resetChanged();

    function changeTitles() {
        if (currentLocation !== document.title) resetChanged();

        // MAIN TITLE - no API key required
        if (window.location.href.includes("/watch")) {
            let titleMatch = document.title.match(/^(?:\([0-9]+\) )?(.*?)(?: - YouTube)$/); // ("(n) ") + "TITLE - YouTube"
            let pageTitle = document.getElementsByClassName("title style-scope ytd-video-primary-info-renderer");

            if (pageTitle.length > 0 && pageTitle[0] !== undefined && titleMatch != null) {
                if (pageTitle[0].innerText != titleMatch[1]) {
                    console.log("Reverting main video title '" + pageTitle[0].innerText + "' to '" + titleMatch[1] + "'");
                    pageTitle[0].innerText = titleMatch[1];
                }
            }
        }

        if (NO_API_KEY) return;

        // REFERENCED VIDEO TITLES - find video link elements in the page that have not yet been changed
        let links = Array.prototype.slice.call(document.getElementsByTagName("a")).filter(a => {
            return a.id == 'video-title' && alreadyChanged.indexOf(a) == -1;
        });
        let spans = Array.prototype.slice.call(document.getElementsByTagName("span")).filter(a => {
            return a.id == 'video-title' &&
                !a.className.includes("-radio-") &&
                !a.className.includes("-playlist-") &&
                alreadyChanged.indexOf(a) == -1;
        });
        links = links.concat(spans).slice(0, 30);

        // MAIN VIDEO DESCRIPTION - request to load original video description
        let mainVidID = "";
        if (!changedDescription && window.location.href.includes("/watch")) {
            mainVidID = window.location.href.split('v=')[1].split('&')[0];
        }

        if (mainVidID == "" && links.length <= 0) return;

        // Initiate API request

        console.log("Checking " + (mainVidID != "" ? "main video and " : "") + links.length + " video titles!");

        // Get all videoIDs to put in the API request
        let IDs = links.map(a => getVideoID(a));
        let APIFetchIDs = IDs.filter(id => cachedTitles[id] === undefined);
        let requestUrl = url_template.replace("{IDs}", (mainVidID != "" ? (mainVidID + ",") : "") + APIFetchIDs.join(','));

        // Issue API request
        let xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;

            // Success
            let data = JSON.parse(xhr.responseText);

            if (data.kind !== "youtube#videoListResponse") {
                console.log("API Request Failed!");
                console.log(requestUrl);
                console.log(data);

                // This ensures that occasional fails don't stall the script
                // But if the first query is a fail then it won't try repeatedly
                NO_API_KEY = !API_KEY_VALID;
                if (NO_API_KEY) {
                    GM_setValue('api_key', '');
                    console.log("API Key Fail! Please Reload!");
                }
                return;
            }

            API_KEY_VALID = true;
            data = data.items;

            if (mainVidID != "") {
                // Replace Main Video Description
                let videoDescription = data[0].snippet.description;
                let pageDescription = document.getElementsByClassName("content style-scope ytd-video-secondary-info-renderer");
                if (pageDescription.length > 0 && videoDescription != null && pageDescription[0] !== undefined) {
                    // linkify replaces links correctly, but without redirect or other specific youtube stuff (no problem if missing)
                    // Still critical, since it replaces ALL descriptions, even if it was not translated in the first place (no easy comparision possible)
                    pageDescription[0].innerHTML = linkify(videoDescription);
                    console.log("Reverting main video description!");
                    changedDescription = true;
                } else {
                    console.log("Failed to find main video description!");
                }
            }

            // Create dictionary for all IDs and their original titles
            data = data.forEach(v => {
                cachedTitles[v.id] = v.snippet.title;
            });

            // Change all previously found link elements
            for (let i = 0; i < links.length; i++) {
                let curID = getVideoID(links[i]);
                if (curID !== IDs[i]) { // Can happen when Youtube was still loading when script was invoked
                    console.log("YouTube was too slow again...");
                    changedDescription = false; // Might not have been loaded aswell - fixes rare errors
                }

                if (cachedTitles[curID] === undefined) continue;

                let originalTitle = cachedTitles[curID];
                let pageTitle = links[i].innerText.trim();
                if (pageTitle != originalTitle.replace(/\s{2,}/g, ' ')) {
                    console.log("'" + pageTitle + "' --> '" + originalTitle + "'");
                    links[i].innerText = originalTitle;
                }
                alreadyChanged.push(links[i]);
            }
        };
        xhr.open('GET', requestUrl);
        xhr.send();
    }

    function linkify(inputText) {
        let replacedText, replacePattern1, replacePattern2, replacePattern3;

        //URLs starting with http://, https://, or ftp://
        replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
        replacedText = inputText.replace(replacePattern1, '<a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="$1">$1</a>');


        //URLs starting with "www." (without // before it, or it'd re-link the ones done above).
        replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
        replacedText = replacedText.replace(replacePattern2, '<a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="http://$1">$1</a>');

        //Change email addresses to mailto:: links.
        replacePattern3 = /(([a-zA-Z0-9\-\_\.])+@[a-zA-Z\_]+?(\.[a-zA-Z]{2,6})+)/gim;
        replacedText = replacedText.replace(replacePattern3, '<a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="mailto:$1">$1</a>');

        return replacedText;
    }

    // Execute every seconds in case new content has been added to the page
    // DOM listener would be good if it was not for the fact that Youtube changes its DOM frequently
    setInterval(changeTitles, 1000);
})();