# Examples

1. Count per status
?$apply=groupby((status), aggregate($count as total))

2. Count per follow-up group, with the group name
?$apply=groupby((followUpGroup/name), aggregate($count as total))

3. Count per group and status
?$apply=groupby((followUpGroup/name, status), aggregate($count as total))

4. Open incidents per group
?$apply=filter(status eq 'New' or status eq 'InProgress')/groupby((followUpGroup/name), aggregate($count as open))

5. Oldest open incident per group
?$apply=filter(status eq 'New' or status eq 'InProgress')/groupby((followUpGroup/name), aggregate(incidentDate with min as oldestOpen, $count as open))

6. Group overview
?$apply=groupby((followUpGroup/name), aggregate(incidentDate with max as newest, incidentDate with min as oldest, attachmentCount with sum as attachmentTotal, actionListCount with average as avgActions, $count as total))

7. Overdue per group
?$apply=filter(dueDate lt now() and status ne 'Resolved' and status ne 'Rejected')/groupby((followUpGroup/name), aggregate($count as overdue, dueDate with min as mostOverdue))

8. Summary for the whole customer
?$apply=aggregate($count as total, incidentDate with max as latest, attachmentCount with sum as attachmentTotal)

9. Reporting group → follow-up group
?$apply=filter(reportedByGroup/id ne null and followUpGroup/id ne null)/groupby((reportedByGroup/name, followUpGroup/name), aggregate($count as total))

10. Severity spread per incident type
?$apply=filter(type/id ne null)/groupby((type/title, severity), aggregate($count as total))

11. Same, but keeping deleted types
?$apply=groupby((typeId, severity), aggregate($count as total))

12. Distinct reporting groups per area
?$apply=filter(type/id ne null and area/id ne null and reportedByGroup/id ne null)/groupby((area/name), aggregate(reportedByGroupId with countdistinct as reportingGroups))

13. Distinct reporting groups per area
?$apply=filter(type/id ne null and area/id ne null and reportedByGroup/id ne null)/groupby((area/name), aggregate(reportedByGroupId with countdistinct as reportingGroups))


14. idk
?$apply=filter(incidentDate ge 2025-01-01T00:00:00Z and type/id ne null and followUpGroup/id ne null)
  /compute(year(incidentDate) as y, month(incidentDate) as m)
  /groupby((followUpGroup/name, type/title, y, m), aggregate(
      $count as total,
      incidentDate with min as firstSeen,
      incidentDate with max as lastSeen,
      attachmentCount with sum as attachmentTotal,
      actionListCount with average as avgActions))
  /filter(total ge 3)
&$orderby=total desc&$top=10