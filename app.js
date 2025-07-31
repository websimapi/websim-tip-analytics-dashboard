import { marked } from 'marked';
import DOMPurify from 'dompurify';

class TipAnalytics {
    constructor() {
        this.projectId = null;
        this.tips = [];
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
            await this.loadTips();
        } catch (error) {
            console.error('Failed to initialize:', error);
        }
    }

    bindEvents() {
        document.getElementById('refresh-btn').addEventListener('click', () => this.loadTips(true));
        document.getElementById('export-btn').addEventListener('click', () => this.exportCSV());
        document.getElementById('load-more').addEventListener('click', () => this.loadMore());
        document.getElementById('show-images').addEventListener('change', () => this.renderTips());
        document.getElementById('only-tips').addEventListener('change', () => this.loadTips(true));

        // Listen for new tips
        window.websim.addEventListener('comment:created', (data) => {
            if (data.comment.card_data?.type === 'tip_comment') {
                this.prependTip(data.comment);
            }
        });
    }

    async loadTips(reset = false) {
        if (this.isLoading) return;
        
        this.isLoading = true;
        if (reset) {
            this.tips = [];
            this.cursor = null;
            this.hasMore = true;
        }

        try {
            const params = new URLSearchParams();
            params.append('only_tips', 'true');
            params.append('first', '24');
            if (this.cursor) params.append('after', this.cursor);

            const response = await fetch(`/api/v1/projects/${this.projectId}/comments?${params}`);
            const data = await response.json();
            
            // Fix: Access the correct data structure
            const comments = data.comments?.data || [];
            this.tips = reset ? comments : [...this.tips, ...comments];
            this.hasMore = data.comments?.has_next_page || false;
            
            this.updateStats();
            this.renderTips();
            this.renderTopTippers();
            
        } catch (error) {
            console.error('Error loading tips:', error);
            const container = document.getElementById('tips-list');
            container.innerHTML = '<div class="loading">Error loading tips. Try refreshing.</div>';
        } finally {
            this.isLoading = false;
        }
    }

    async loadMore() {
        if (this.hasMore && !this.isLoading) {
            await this.loadTips();
        }
    }

    updateStats() {
        const tips = this.tips.map(t => t.comment || t);
        
        // Total tips
        const totalTips = tips.length;
        document.getElementById('total-tips').textContent = totalTips;

        // Total credits
        const totalCredits = tips.reduce((sum, tip) => {
            const comment = tip.comment || tip;
            return sum + (comment.card_data?.credits_spent || 0);
        }, 0);
        document.getElementById('total-credits').textContent = totalCredits.toLocaleString();

        // Unique tippers
        const uniqueTippers = new Set(tips.map(tip => {
            const comment = tip.comment || tip;
            return comment.author.id;
        })).size;
        document.getElementById('unique-tippers').textContent = uniqueTippers;

        // Average tip size
        const avgTip = totalTips > 0 ? Math.round(totalCredits / totalTips) : 0;
        document.getElementById('avg-tip').textContent = avgTip.toLocaleString();
    }

    renderTips() {
        const container = document.getElementById('tips-list');
        const showImages = document.getElementById('show-images').checked;
        
        if (this.tips.length === 0) {
            container.innerHTML = '<div class="loading">No tips yet</div>';
            return;
        }

        container.innerHTML = this.tips.map(item => {
            const comment = item.comment || item;
            return this.renderTipItem(comment, showImages);
        }).join('');
        
        const loadMoreBtn = document.getElementById('load-more');
        loadMoreBtn.style.display = this.hasMore ? 'block' : 'none';
    }

    renderTipItem(tip, showImages) {
        const amount = tip.card_data?.credits_spent || 0;
        const time = new Date(tip.created_at).toLocaleString();
        const content = DOMPurify.sanitize(marked.parse(tip.raw_content || 'No message'));
        
        const images = tip.content?.content?.filter(c => c.type === 'image') || [];
        const imageUrls = images.map(img => img.attrs.src);

        return `
            <div class="tip-item">
                <div class="tip-avatar">
                    ${tip.author.username.charAt(0).toUpperCase()}
                </div>
                <div class="tip-content">
                    <div class="tip-header">
                        <span class="tip-username">@${tip.author.username}</span>
                        <span class="tip-amount">${amount} credits</span>
                    </div>
                    <div class="tip-time">${time}</div>
                    <div class="tip-message">${content}</div>
                    ${showImages && imageUrls.length > 0 ? `
                        <div class="tip-images">
                            ${imageUrls.map(url => `<img src="${url}" alt="Tip image">`).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    renderTopTippers() {
        const tips = this.tips.map(t => t.comment || t);
        const tippers = {};

        tips.forEach(tip => {
            const author = tip.author;
            if (!tippers[author.id]) {
                tippers[author.id] = {
                    username: author.username,
                    displayName: author.display_name,
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
        container.innerHTML = sortedTippers.map(tipper => `
            <div class="top-tipper">
                <div class="top-tipper-avatar">
                    ${tipper.username.charAt(0).toUpperCase()}
                </div>
                <div class="top-tipper-info">
                    <div class="top-tipper-name">@${tipper.username}</div>
                    <div class="top-tipper-stats">
                        ${tipper.tips} tips • ${tipper.credits.toLocaleString()} credits
                    </div>
                </div>
            </div>
        `).join('');
    }

    prependTip(comment) {
        this.tips.unshift({ comment });
        this.updateStats();
        this.renderTips();
        this.renderTopTippers();
    }

    getLastCursor(items) {
        if (items.length === 0) return null;
        // Fix: Return the actual cursor value from the last item
        return items[items.length - 1]?.comment?.id || items[items.length - 1]?.id;
    }

    exportCSV() {
        const tips = this.tips.map(t => t.comment || t);
        const csv = [
            'Username,Display Name,Tips,Credits,Last Tip,Message',
            ...tips.map(tip => [
                tip.author.username,
                tip.author.display_name || tip.author.username,
                1,
                tip.card_data?.credits_spent || 0,
                new Date(tip.created_at).toISOString(),
                `"${(tip.raw_content || '').replace(/"/g, '""')}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tips-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
}

// Initialize the app
new TipAnalytics();