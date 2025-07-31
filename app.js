import { marked } from 'marked';
import DOMPurify from 'dompurify';

class TipAnalytics {
    constructor() {
        this.projectId = null;
        this.allComments = new Map(); // Use a map to store all comments by ID to prevent duplicates
        this.cursor = null;
        this.hasMore = true;
        this.isLoading = false;
        
        this.init();
    }

    async init() {
        try {
            const project = await window.websim.getCurrentProject();
            this.projectId = project.id;
            
            this.bindEvents();
            await this.loadTips(true); // Initial load
        } catch (error) {
            console.error('Failed to initialize:', error);
            const container = document.getElementById('tips-list');
            container.innerHTML = `<div class="loading">Error initializing dashboard. Please refresh.</div>`;
        }
    }

    bindEvents() {
        document.getElementById('refresh-btn').addEventListener('click', () => this.loadTips(true));
        document.getElementById('export-btn').addEventListener('click', () => this.exportCSV());
        document.getElementById('load-more').addEventListener('click', () => this.loadMore());
        document.getElementById('show-images').addEventListener('change', () => this.render());

        // Listen for new tips
        window.websim.addEventListener('comment:created', (data) => {
            if (data.comment.card_data?.type === 'tip_comment') {
                this.addComment(data.comment, true); // Add to the beginning
                this.render();
            }
        });
    }

    async loadTips(reset = false) {
        if (this.isLoading) return;
        
        this.isLoading = true;
        document.getElementById('tips-list').classList.add('loading-active');
        if (reset) {
            this.allComments.clear();
            this.cursor = null;
            this.hasMore = true;
        }

        try {
            const params = new URLSearchParams();
            params.append('only_tips', 'true');
            params.append('first', '20');
            if (this.cursor) {
                params.append('after', this.cursor);
            }

            const response = await fetch(`/api/v1/projects/${this.projectId}/comments?${params}`);
            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }
            const data = await response.json();
            
            const commentsData = data.comments?.data || [];
            if (commentsData.length === 0 && this.allComments.size === 0) {
                 document.getElementById('tips-list').innerHTML = '<div class="loading">No tips have been received for this project yet.</div>';
            }

            commentsData.forEach(item => {
                this.addComment(item.comment);
            });
            
            this.hasMore = data.comments?.has_next_page || false;
            this.cursor = this.getLastCursor();
            
            this.render();
            
        } catch (error) {
            console.error('Error loading tips:', error);
            const container = document.getElementById('tips-list');
            if (this.allComments.size === 0) {
                 container.innerHTML = '<div class="loading">Error loading tips. Please try refreshing.</div>';
            }
        } finally {
            this.isLoading = false;
            document.getElementById('tips-list').classList.remove('loading-active');
        }
    }

    async loadMore() {
        if (this.hasMore && !this.isLoading) {
            await this.loadTips();
        }
    }

    addComment(comment, prepend = false) {
        if (!comment || !comment.id) return;

        // If prepending, we might need to re-order if the map already has it.
        if (prepend && this.allComments.has(comment.id)) {
            this.allComments.delete(comment.id);
        }
        
        if (prepend) {
            const currentEntries = Array.from(this.allComments.entries());
            this.allComments.clear();
            this.allComments.set(comment.id, comment);
            currentEntries.forEach(([id, c]) => this.allComments.set(id, c));
        } else {
            this.allComments.set(comment.id, comment);
        }
    }
    
    get tips() {
        return Array.from(this.allComments.values());
    }

    render() {
        this.updateStats();
        this.renderTips();
        this.renderTopTippers();
    }

    updateStats() {
        const tips = this.tips;
        
        const totalTips = tips.length;
        document.getElementById('total-tips').textContent = totalTips.toLocaleString();

        const totalCredits = tips.reduce((sum, tip) => sum + (tip.card_data?.credits_spent || 0), 0);
        document.getElementById('total-credits').textContent = totalCredits.toLocaleString();

        const uniqueTippers = new Set(tips.map(tip => tip.author.id)).size;
        document.getElementById('unique-tippers').textContent = uniqueTippers.toLocaleString();

        const avgTip = totalTips > 0 ? Math.round(totalCredits / totalTips) : 0;
        document.getElementById('avg-tip').textContent = avgTip.toLocaleString();
    }

    renderTips() {
        const container = document.getElementById('tips-list');
        const showImages = document.getElementById('show-images').checked;
        const tips = this.tips;
        
        if (tips.length === 0 && !this.isLoading) {
             if (container.innerHTML.includes('Loading')) {
                container.innerHTML = '<div class="loading">No tips yet.</div>';
             }
            return;
        }

        container.innerHTML = tips.map(tip => this.renderTipItem(tip, showImages)).join('');
        
        const loadMoreBtn = document.getElementById('load-more');
        loadMoreBtn.style.display = this.hasMore ? 'block' : 'none';
    }

    renderTipItem(tip, showImages) {
        const amount = tip.card_data?.credits_spent || 0;
        const time = new Date(tip.created_at).toLocaleString();
        
        const content = tip.raw_content ? DOMPurify.sanitize(marked.parse(tip.raw_content)) : 'No message';

        let imageUrls = [];
        if (tip.content?.content) {
            tip.content.content.forEach(node => {
                if (node.type === 'image' && node.attrs?.src) {
                    imageUrls.push(node.attrs.src);
                }
            });
        }

        return `
            <div class="tip-item" data-comment-id="${tip.id}">
                <div class="tip-avatar" title="${tip.author.username}">
                    ${tip.author.username.charAt(0).toUpperCase()}
                </div>
                <div class="tip-content">
                    <div class="tip-header">
                        <span class="tip-username">@${tip.author.username}</span>
                        <span class="tip-amount">💰 ${amount.toLocaleString()} credits</span>
                    </div>
                    <div class="tip-time">${time}</div>
                    <div class="tip-message">${content}</div>
                    ${showImages && imageUrls.length > 0 ? `
                        <div class="tip-images">
                            ${imageUrls.slice(0, 4).map(url => `<img src="${url}" alt="Tip image" loading="lazy">`).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    renderTopTippers() {
        const tippers = {};

        this.tips.forEach(tip => {
            const author = tip.author;
            if (!tippers[author.id]) {
                tippers[author.id] = {
                    id: author.id,
                    username: author.username,
                    tips: 0,
                    credits: 0
                };
            }
            tippers[author.id].tips += 1;
            tippers[author.id].credits += tip.card_data?.credits_spent || 0;
        });

        const sortedTippers = Object.values(tippers)
            .sort((a, b) => b.credits - a.credits)
            .slice(0, 5);

        const container = document.getElementById('top-tippers');
        container.innerHTML = sortedTippers.length > 0 ? sortedTippers.map(tipper => `
            <div class="top-tipper">
                <div class="top-tipper-avatar">
                    ${tipper.username.charAt(0).toUpperCase()}
                </div>
                <div class="top-tipper-info">
                    <div class="top-tipper-name">@${tipper.username}</div>
                    <div class="top-tipper-stats">
                        ${tipper.tips} tip${tipper.tips !== 1 ? 's' : ''} • ${tipper.credits.toLocaleString()} credits
                    </div>
                </div>
            </div>
        `).join('') : '<div class="loading">No tips received yet.</div>';
    }

    getLastCursor() {
        const tips = this.tips;
        if (tips.length === 0) return null;
        return tips[tips.length - 1].id;
    }

    exportCSV() {
        const tips = this.tips;
        if (tips.length === 0) {
            alert("No tips to export.");
            return;
        }

        const headers = ['id', 'username', 'display_name', 'credits_spent', 'timestamp', 'message'];
        const csvRows = [
            headers.join(','),
            ...tips.map(tip => {
                const values = [
                    tip.id,
                    tip.author.username,
                    tip.author.display_name || tip.author.username,
                    tip.card_data?.credits_spent || 0,
                    new Date(tip.created_at).toISOString(),
                    `"${(tip.raw_content || '').replace(/"/g, '""')}"`
                ];
                return values.join(',');
            })
        ];
        
        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tips-export-${this.projectId}-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Initialize the app
new TipAnalytics();