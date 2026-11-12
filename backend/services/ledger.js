const db = require("../database/db");

function getGroupLedger(groupId) {
    const members = db.prepare(`
        SELECT id, name, is_active
        FROM members
        WHERE group_id = ?
        ORDER BY name COLLATE NOCASE
    `).all(groupId);

    const paidRows = db.prepare(`
        SELECT payer_id, SUM(amount_cents) AS total_paid
        FROM expenses
        WHERE group_id = ?
        GROUP BY payer_id
    `).all(groupId);

    const shareRows = db.prepare(`
        SELECT es.member_id, SUM(es.amount_cents) AS total_share
        FROM expense_shares es
        JOIN expenses e ON e.id = es.expense_id
        WHERE e.group_id = ?
        GROUP BY es.member_id
    `).all(groupId);

    const paymentRows = db.prepare(`
        SELECT
            from_member_id,
            to_member_id,
            SUM(amount_cents) AS total_amount
        FROM ss_settlement_records
        WHERE group_id = ? AND status = 'paid'
        GROUP BY from_member_id, to_member_id
    `).all(groupId);

    const balances = members.map(member => {
        const paid = paidRows.find(row => row.payer_id === member.id);
        const share = shareRows.find(row => row.member_id === member.id);
        const totalPaid = paid ? Number(paid.total_paid) : 0;
        const totalShare = share ? Number(share.total_share) : 0;

        const sent = paymentRows
            .filter(row => row.from_member_id === member.id)
            .reduce((sum, row) => sum + Number(row.total_amount), 0);

        const received = paymentRows
            .filter(row => row.to_member_id === member.id)
            .reduce((sum, row) => sum + Number(row.total_amount), 0);

        return {
            memberId: member.id,
            name: member.name,
            isActive: Number(member.is_active) !== 0,
            totalPaid,
            totalShare,
            balance: totalPaid - totalShare + sent - received
        };
    });

    const debtors = [];
    const creditors = [];

    balances.forEach(member => {
        if (member.balance < 0) {
            debtors.push({
                id: member.memberId,
                name: member.name,
                amount: -member.balance
            });
        } else if (member.balance > 0) {
            creditors.push({
                id: member.memberId,
                name: member.name,
                amount: member.balance
            });
        }
    });

    const settlements = [];
    let debtorIndex = 0;
    let creditorIndex = 0;

    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
        const amount = Math.min(
            debtors[debtorIndex].amount,
            creditors[creditorIndex].amount
        );

        if (amount > 0) {
            settlements.push({
                fromId: debtors[debtorIndex].id,
                from: debtors[debtorIndex].name,
                toId: creditors[creditorIndex].id,
                to: creditors[creditorIndex].name,
                amountCents: amount,
                status: "pending"
            });
        }

        debtors[debtorIndex].amount -= amount;
        creditors[creditorIndex].amount -= amount;

        if (debtors[debtorIndex].amount === 0) debtorIndex += 1;
        if (creditors[creditorIndex].amount === 0) creditorIndex += 1;
    }

    return { balances, settlements };
}

module.exports = {
    getGroupLedger
};
