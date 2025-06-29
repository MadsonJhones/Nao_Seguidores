let scanAbortController;

// Ouve o evento de clique no ícone da extensão
chrome.action.onClicked.addListener((tab) => {
    const managerUrl = chrome.runtime.getURL("index.html");
    chrome.tabs.query({ url: managerUrl }, (tabs) => {
        if (tabs.length === 0) {
            chrome.tabs.create({ url: managerUrl });
        } else {
            chrome.tabs.update(tabs[0].id, { active: true });
        }
    });
});

// Busca o ID e as contagens de seguidores/seguindo
async function getProfileInfo(username, headers, signal) {
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
    const response = await fetch(url, { headers, signal });
    if (!response.ok) throw new Error(`Não foi possível buscar o perfil de ${username}.`);
    const data = await response.json();
    const user = data?.data?.user;
    if (!user?.id) throw new Error(`A resposta da API para ${username} não continha um ID.`);
    return {
        userId: user.id,
        totalFollowing: user.edge_follow.count,
        totalFollowers: user.edge_followed_by.count,
    };
}

// Busca uma lista paginada e envia atualizações de progresso
async function fetchPaginatedList(userId, listType, totalCount, headers, tabId, signal) {
    let allUsers = [];
    let nextMaxId = '';
    let hasNextPage = true;
    const startTime = Date.now();

    while (hasNextPage) {
        const url = `https://www.instagram.com/api/v1/friendships/${userId}/${listType}/?count=50&max_id=${nextMaxId}`;
        const response = await fetch(url, { headers, signal });
        if (!response.ok) {
            if (response.status === 429) throw new Error("Muitas requisições. O Instagram pediu uma pausa (Erro 429).");
            throw new Error(`Falha na API para a lista ${listType}: ${response.statusText}`);
        }
        const data = await response.json();
        const users = data.users.map(u => ({ id: u.pk, username: u.username, fullName: u.full_name, picUrl: u.profile_pic_url }));
        
        allUsers = allUsers.concat(users);
        nextMaxId = data.next_max_id;
        hasNextPage = !!nextMaxId;

        const percentage = Math.min(100, Math.round((allUsers.length / totalCount) * 100));
        const elapsedTime = (Date.now() - startTime) / 1000;
        const timePerUser = elapsedTime / allUsers.length;
        const remainingUsers = totalCount - allUsers.length;
        const estimatedTimeLeft = Math.round(remainingUsers * timePerUser);

        chrome.tabs.sendMessage(tabId, {
            action: 'progressUpdate',
            data: {
                current: allUsers.length,
                total: totalCount,
                percentage: percentage,
                timeLeft: estimatedTimeLeft,
                stage: `Coletando ${listType}...`
            }
        });

        if (hasNextPage) await new Promise(resolve => setTimeout(resolve, 250));
    }
    return allUsers;
}

// Executa a ação de unfollow para um usuário específico
async function unfollowUserById(userId, headers) {
    const url = `https://www.instagram.com/api/v1/friendships/destroy/${userId}/`;
    const response = await fetch(url, {
        method: 'POST',
        headers: headers
    });
    if (!response.ok) {
        throw new Error(`Falha ao deixar de seguir. Status: ${response.status}`);
    }
    const data = await response.json();
    if (data.status !== 'ok') {
        throw new Error('A API do Instagram não confirmou o unfollow.');
    }
    return true;
}

// Ouve mensagens da nossa página (index.js)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        const csrfCookie = await chrome.cookies.get({ url: "https://www.instagram.com", name: "csrftoken" });
        if (!csrfCookie) {
            sendResponse({ success: false, message: "Cookie de autenticação não encontrado." });
            return;
        }
        
        // ========= ALTERAÇÃO PRINCIPAL AQUI =========
        const headers = {
            'x-ig-app-id': '1217981644879628', // ID de aplicativo web alternativo e mais estável
            'x-csrftoken': csrfCookie.value,
            'x-ig-www-claim': '0', // Header adicional frequentemente necessário
            'X-Requested-With': 'XMLHttpRequest' // Header que simula uma requisição do próprio site
        };
        // ============================================

        if (request.action === "startScan") {
            scanAbortController = new AbortController();
            try {
                const queryOptions = { currentWindow: true, url: "https://*.instagram.com/*" };
                const tabs = await chrome.tabs.query(queryOptions);
                if (tabs.length === 0) throw new Error("Nenhuma aba do Instagram encontrada nesta janela.");
                
                const instagramTab = tabs[tabs.length - 1];
                const url = new URL(instagramTab.url);
                const pathParts = url.pathname.split('/').filter(part => part);
                if (pathParts.length === 0) throw new Error("A aba encontrada não é de um perfil.");
                const username = pathParts[0];
                
                const profileInfo = await getProfileInfo(username, headers, scanAbortController.signal);
                const following = await fetchPaginatedList(profileInfo.userId, 'following', profileInfo.totalFollowing, headers, sender.tab.id, scanAbortController.signal);
                const followers = await fetchPaginatedList(profileInfo.userId, 'followers', profileInfo.totalFollowers, headers, sender.tab.id, scanAbortController.signal);
                
                sendResponse({ success: true, data: { following, followers } });

            } catch (error) {
                if (error.name === 'AbortError') {
                    sendResponse({ success: false, message: 'Análise cancelada pelo usuário.', cancelled: true });
                } else {
                    sendResponse({ success: false, message: error.message });
                }
            }
        } 
        else if (request.action === "unfollowUser") {
            try {
                const { userId } = request.payload;
                await unfollowUserById(userId, headers);
                sendResponse({ success: true });
            } catch (error) {
                sendResponse({ success: false, message: error.message });
            }
        }
        else if (request.action === "cancelScan") {
            if (scanAbortController) {
                scanAbortController.abort();
                sendResponse({ success: true, message: "Sinal de cancelamento enviado." });
            }
        }
    })();
    return true;
});